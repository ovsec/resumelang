package server

import (
	"context"
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

func (s *firestoreStore) Save(uid, id, name, yaml string) (SavedResume, error) {
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
		CreatedAt: now,
		UpdatedAt: now,
	}
	if r.Name == "" {
		r.Name = "Untitled resume"
	}
	if _, err := s.col(uid).Doc(r.ID).Set(ctx, r); err != nil {
		return SavedResume{}, err
	}
	return r, nil
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
	return r, nil
}
