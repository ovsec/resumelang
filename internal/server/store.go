package server

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"time"
)

type SavedResume struct {
	ID        string    `json:"id" firestore:"id"`
	Name      string    `json:"name" firestore:"name"`
	YAML      string    `json:"yaml" firestore:"yaml"`
	CreatedAt time.Time `json:"created_at" firestore:"created_at"`
	UpdatedAt time.Time `json:"updated_at" firestore:"updated_at"`
}

// Store is the persistence backend for user resumes.
type Store interface {
	List(uid string) ([]SavedResume, error)
	Save(uid, id, name, yaml string) (SavedResume, error)
	Delete(uid, id string) error
	GetByID(id string) (SavedResume, error)
}

var globalStore Store

// NewStore returns a Firestore-backed store when GOOGLE_CLOUD_PROJECT is set,
// otherwise falls back to the local file store.
func NewStore(ctx context.Context) (Store, error) {
	if proj := os.Getenv("GOOGLE_CLOUD_PROJECT"); proj != "" {
		return newFirestoreStore(ctx, proj)
	}
	return &fileStore{root: "data"}, nil
}

// ── File store (local dev) ─────────────────────────────────────────

type fileStore struct {
	root string
}

func (s *fileStore) path(uid string) string {
	return filepath.Join(s.root, uid, "resumes.json")
}

func (s *fileStore) load(uid string) ([]SavedResume, error) {
	data, err := os.ReadFile(s.path(uid))
	if os.IsNotExist(err) {
		return []SavedResume{}, nil
	}
	if err != nil {
		return nil, err
	}
	var list []SavedResume
	if err := json.Unmarshal(data, &list); err != nil {
		return nil, err
	}
	return list, nil
}

func (s *fileStore) write(uid string, list []SavedResume) error {
	p := s.path(uid)
	if err := os.MkdirAll(filepath.Dir(p), 0755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(list, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(p, data, 0644)
}

func (s *fileStore) List(uid string) ([]SavedResume, error) {
	return s.load(uid)
}

func (s *fileStore) Save(uid, id, name, yaml string) (SavedResume, error) {
	list, err := s.load(uid)
	if err != nil {
		return SavedResume{}, err
	}
	now := time.Now().UTC()
	for i, r := range list {
		if r.ID == id {
			list[i].Name = name
			list[i].YAML = yaml
			list[i].UpdatedAt = now
			if err := s.write(uid, list); err != nil {
				return SavedResume{}, err
			}
			return list[i], nil
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
	list = append(list, r)
	if err := s.write(uid, list); err != nil {
		return SavedResume{}, err
	}
	return r, nil
}

func (s *fileStore) Delete(uid, id string) error {
	list, err := s.load(uid)
	if err != nil {
		return err
	}
	filtered := list[:0]
	for _, r := range list {
		if r.ID != id {
			filtered = append(filtered, r)
		}
	}
	return s.write(uid, filtered)
}

func (s *fileStore) GetByID(id string) (SavedResume, error) {
	entries, err := os.ReadDir(s.root)
	if err != nil {
		return SavedResume{}, os.ErrNotExist
	}
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		list, err := s.load(e.Name())
		if err != nil {
			continue
		}
		for _, r := range list {
			if r.ID == id {
				return r, nil
			}
		}
	}
	return SavedResume{}, os.ErrNotExist
}

func newID() string {
	b := make([]byte, 8)
	rand.Read(b)
	return hex.EncodeToString(b)
}
