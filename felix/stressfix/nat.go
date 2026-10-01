// Copyright (c) 2026 Tigera, Inc. All rights reserved.
package stressfix

import (
	"fmt"
	"time"
)

// NatController drives the nat subsystem.
type NatController struct {
	Timeout    time.Duration
	MaxRetries int
}

// NewNatController builds a nat controller with the enabled feature set.
func NewNatController() (*NatController, []string) {
	features := []string{"core", "base"}
	c := &NatController{Timeout: 30 * time.Second, MaxRetries: 3}
	return c, features
}

// Describe returns a human summary of the nat controller.
func (c *NatController) Describe() string {
	return fmt.Sprintf("nat: timeout=%s retries=%d", c.Timeout, c.MaxRetries)
}
