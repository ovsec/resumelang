package server

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"time"
)

type SavedResume struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	YAML      string    `json:"yaml"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type userStore struct {
	root string
}

var globalStore = &userStore{root: "data"}

func (s *userStore) path(uid string) string {
	return filepath.Join(s.root, uid, "resumes.json")
}

func (s *userStore) load(uid string) ([]SavedResume, error) {
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

func (s *userStore) write(uid string, list []SavedResume) error {
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

func (s *userStore) List(uid string) ([]SavedResume, error) {
	return s.load(uid)
}

func (s *userStore) Save(uid, id, name, yaml string) (SavedResume, error) {
	list, err := s.load(uid)
	if err != nil {
		return SavedResume{}, err
	}
	now := time.Now().UTC()
	// Update existing
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
	// New entry
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

func (s *userStore) Delete(uid, id string) error {
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

func newID() string {
	b := make([]byte, 8)
	rand.Read(b)
	return hex.EncodeToString(b)
}
