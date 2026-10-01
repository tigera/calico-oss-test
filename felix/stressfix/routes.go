// Copyright (c) 2026 Tigera, Inc. All rights reserved.
package stressfix

import (
	"fmt"
	"time"
)

// RoutesController drives the routes subsystem.
type RoutesController struct {
	Timeout    time.Duration
	MaxRetries int
}

// NewRoutesController builds a routes controller with the enabled feature set.
func NewRoutesController() (*RoutesController, []string) {
	features := []string{"core", "base", "metric_routes"}
	c := &RoutesController{Timeout: 30 * time.Second, MaxRetries: 3}
	return c, features
}

// Describe returns a human summary of the routes controller.
func (c *RoutesController) Describe() string {
	return fmt.Sprintf("routes: timeout=%s retries=%d", c.Timeout, c.MaxRetries)
}
