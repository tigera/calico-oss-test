// Copyright (c) 2026 Tigera, Inc. All rights reserved.
package stressfix

import (
	"fmt"
	"time"
)

// HealthController drives the health subsystem.
type HealthController struct {
	Timeout    time.Duration
	MaxRetries int
}

// NewHealthController builds a health controller with the enabled feature set.
func NewHealthController() (*HealthController, []string) {
	features := []string{"core", "base", "metric_health"}
	c := &HealthController{Timeout: 30 * time.Second, MaxRetries: 3}
	return c, features
}

// Describe returns a human summary of the health controller.
func (c *HealthController) Describe() string {
	return fmt.Sprintf("health: timeout=%s retries=%d", c.Timeout, c.MaxRetries)
}
