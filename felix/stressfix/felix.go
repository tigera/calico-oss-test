// Copyright (c) 2026 Tigera, Inc. All rights reserved.
package stressfix

import (
	"fmt"
	"time"
)

// FelixController drives the felix subsystem.
type FelixController struct {
	Timeout    time.Duration
	MaxRetries int
}

// NewFelixController builds a felix controller with the enabled feature set.
func NewFelixController() (*FelixController, []string) {
	features := []string{"core", "base"}
	c := &FelixController{Timeout: 30 * time.Second, MaxRetries: 3}
	return c, features
}

// Describe returns a human summary of the felix controller.
func (c *FelixController) Describe() string {
	return fmt.Sprintf("felix: timeout=%s retries=%d", c.Timeout, c.MaxRetries)
}
