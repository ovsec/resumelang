package server

import (
	"context"
	"crypto/sha256"
	"fmt"
	"os"
	"sort"
	"time"

	"cloud.google.com/go/firestore"
	"google.golang.org/api/iterator"
)

type firestoreStore struct {
	client *firestore.Client
}

func newFirestoreStore(ctx context.Context, projectID string) (*firestoreStore, error) {
	client, err := firestore.NewClient(ctx, projectID)
	if err != nil {
		return nil, err
	}
	return &firestoreStore{client: client}, nil
}

// userResumesCol returns the nested resumes collection for a specific user.
// Path: users/{uid}/resumes
func (s *firestoreStore) userResumesCol(uid string) *firestore.CollectionRef {
	return s.client.Collection("users").Doc(uid).Collection("resumes")
}

// resumesCol returns the top-level resumes collection (used for legacy data).
func (s *firestoreStore) resumesCol() *firestore.CollectionRef {
	return s.client.Collection("resumes")
}

func (s *firestoreStore) List(uid string) ([]SavedResume, error) {
	ctx := context.Background()

	// Primary: query nested path users/{uid}/resumes
	iter := s.userResumesCol(uid).Documents(ctx)
	defer iter.Stop()

	var list []SavedResume
	for {
		doc, err := iter.Next()
		if err == iterator.Done {
			break
		}
		if err != nil {
			fmt.Fprintf(os.Stderr, "List: nested path query failed for %s: %v\n", uid, err)
			break
		}
		var r SavedResume
		if err := doc.DataTo(&r); err != nil {
			continue
		}
		list = append(list, r)
	}

	// If no results in nested path, try migrating from top-level collection
	if len(list) == 0 {
		fmt.Fprintf(os.Stderr, "List: no results in nested path for %s, trying top-level migration\n", uid)
		return s.migrateFromTopLevel(uid)
	}

	// Sort by updated_at descending in memory
	sort.Slice(list, func(i, j int) bool {
		return list[i].UpdatedAt.After(list[j].UpdatedAt)
	})

	fmt.Fprintf(os.Stderr, "List: returning %d resumes for %s\n", len(list), uid)
	return list, nil
}

// migrateFromTopLevel migrates resumes from top-level collection to nested path.
// Handles legacy data stored in top-level "resumes" collection with user_id field.
func (s *firestoreStore) migrateFromTopLevel(uid string) ([]SavedResume, error) {
	ctx := context.Background()

	iter := s.resumesCol().Where("user_id", "==", uid).Documents(ctx)
	defer iter.Stop()

	var list []SavedResume
	for {
		doc, err := iter.Next()
		if err == iterator.Done {
			break
		}
		if err != nil {
			fmt.Fprintf(os.Stderr, "migrateFromTopLevel: query failed for %s: %v\n", uid, err)
			return list, nil // Return what we have
		}
		var r SavedResume
		if err := doc.DataTo(&r); err != nil {
			continue
		}
		// Migrate to nested path
		_, err = s.userResumesCol(uid).Doc(r.ID).Set(ctx, r)
		if err != nil {
			fmt.Fprintf(os.Stderr, "migrateFromTopLevel: failed to migrate %s for %s: %v\n", r.ID, uid, err)
			continue
		}
		list = append(list, r)
	}

	if list == nil {
		list = []SavedResume{}
	}

	// Sort by updated_at descending
	sort.Slice(list, func(i, j int) bool {
		return list[i].UpdatedAt.After(list[j].UpdatedAt)
	})

	fmt.Fprintf(os.Stderr, "migrateFromTopLevel: migrated %d resumes for %s\n", len(list), uid)
	return list, nil
}

func (s *firestoreStore) Save(uid, id, name, yaml, visibility, password string) (SavedResume, error) {
	ctx := context.Background()
	now := time.Now().UTC()

	// Primary: use nested path users/{uid}/resumes/{id}
	col := s.userResumesCol(uid)

	if id != "" {
		ref := col.Doc(id)
		doc, err := ref.Get(ctx)
		if err == nil {
			var r SavedResume
			doc.DataTo(&r)
			r.Name = name
			r.YAML = yaml
			r.Visibility = visibility
			if password != "" {
				r.Password = hashPassword(password)
			} else {
				r.Password = ""
			}
			r.UpdatedAt = now
			r.UserID = uid // keep field for reference
			if _, err := ref.Set(ctx, r); err != nil {
				return SavedResume{}, err
			}
			return r, nil
		}
	}

	r := SavedResume{
		ID:        newID(),
		Name:      name,
		YAML:      yaml,
		Visibility: visibility,
		UserID:    uid,
		CreatedAt: now,
		UpdatedAt: now,
	}
	if r.Name == "" {
		r.Name = "Untitled resume"
	}
	if password != "" {
		r.Password = hashPassword(password)
	}
	if _, err := col.Doc(r.ID).Set(ctx, r); err != nil {
		return SavedResume{}, err
	}
	return r, nil
}

// hashPassword creates a SHA-256 hash of the password for storage.
func hashPassword(pw string) string {
	h := sha256.Sum256([]byte(pw))
	return fmt.Sprintf("%x", h)
}

func (s *firestoreStore) Delete(uid, id string) error {
	ctx := context.Background()
	ref := s.userResumesCol(uid).Doc(id)
	// Verify the resume belongs to the user before deleting
	doc, err := ref.Get(ctx)
	if err != nil {
		return err
	}
	var r SavedResume
	if err := doc.DataTo(&r); err != nil {
		return err
	}
	if r.UserID != uid {
		return os.ErrPermission
	}
	_, err = ref.Delete(ctx)
	return err
}

func (s *firestoreStore) GetByIDAndUser(id, uid string) (SavedResume, error) {
	ctx := context.Background()
	// Primary: read from nested path
	doc, err := s.userResumesCol(uid).Doc(id).Get(ctx)
	if err != nil {
		// Fallback: try top-level collection (legacy data)
		doc, err = s.resumesCol().Doc(id).Get(ctx)
		if err != nil {
			return SavedResume{}, os.ErrNotExist
		}
	}
	var r SavedResume
	if err := doc.DataTo(&r); err != nil {
		return SavedResume{}, err
	}
	// Must belong to the user
	if r.UserID != uid {
		return SavedResume{}, os.ErrNotExist
	}
	// Must be public (or legacy empty visibility)
	if r.Visibility != "public" && r.Visibility != "" {
		return SavedResume{}, os.ErrNotExist
	}
	return r, nil
}

// GetByID retrieves a resume by ID from the top-level collection (legacy public links).
// New public links use GetByIDAndUser with the full provider-uid-resumeID format.
func (s *firestoreStore) GetByID(id string) (SavedResume, error) {
	ctx := context.Background()
	doc, err := s.resumesCol().Doc(id).Get(ctx)
	if err != nil {
		return SavedResume{}, os.ErrNotExist
	}
	var r SavedResume
	if err := doc.DataTo(&r); err != nil {
		return SavedResume{}, err
	}
	// Public resumes (no password) are accessible; password-protected need validation elsewhere.
	if r.Visibility == "public" || r.Visibility == "" {
		return r, nil
	}
	return SavedResume{}, os.ErrNotExist
}
