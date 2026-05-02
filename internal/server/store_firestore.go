package server

import (
	"context"
	"crypto/sha256"
	"fmt"
	"os"
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

func (s *firestoreStore) col(uid string) *firestore.CollectionRef {
	return s.client.Collection("users").Doc(uid).Collection("resumes")
}

func (s *firestoreStore) List(uid string) ([]SavedResume, error) {
	ctx := context.Background()
	iter := s.col(uid).OrderBy("updated_at", firestore.Desc).Documents(ctx)
	defer iter.Stop()

	var list []SavedResume
	for {
		doc, err := iter.Next()
		if err == iterator.Done {
			break
		}
		if err != nil {
			return nil, err
		}
		var r SavedResume
		if err := doc.DataTo(&r); err != nil {
			continue
		}
		list = append(list, r)
	}
	if list == nil {
		list = []SavedResume{}
	}
	return list, nil
}

func (s *firestoreStore) Save(uid, id, name, yaml, visibility, password string) (SavedResume, error) {
	ctx := context.Background()
	now := time.Now().UTC()

	if id != "" {
		ref := s.col(uid).Doc(id)
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
		CreatedAt: now,
		UpdatedAt: now,
	}
	if r.Name == "" {
		r.Name = "Untitled resume"
	}
	if password != "" {
		r.Password = hashPassword(password)
	}
	if _, err := s.col(uid).Doc(r.ID).Set(ctx, r); err != nil {
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
	_, err := s.col(uid).Doc(id).Delete(ctx)
	return err
}

func (s *firestoreStore) GetByID(id string) (SavedResume, error) {
	ctx := context.Background()
	iter := s.client.CollectionGroup("resumes").Where("id", "==", id).Limit(1).Documents(ctx)
	defer iter.Stop()

	doc, err := iter.Next()
	if err == iterator.Done {
		return SavedResume{}, os.ErrNotExist
	}
	if err != nil {
		return SavedResume{}, err
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

func (s *firestoreStore) GetByIDAndUser(id, uid string) (SavedResume, error) {
	ctx := context.Background()
	ref := s.client.Collection("users").Doc(uid).Collection("resumes").Doc(id)
	doc, err := ref.Get(ctx)
	if err != nil {
		return SavedResume{}, os.ErrNotExist
	}
  var r SavedResume
  if err := doc.DataTo(&r); err != nil {
    return SavedResume{}, err
  }
  // Allow public resumes and legacy resumes with empty visibility
  if r.Visibility != "public" && r.Visibility != "" {
    return SavedResume{}, os.ErrNotExist
  }
  return r, nil
}
