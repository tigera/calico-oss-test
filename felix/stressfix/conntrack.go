// Copyright (c) 2026 Tigera, Inc. All rights reserved.
package stressfix

import (
	"fmt"
	"time"
)

// ConntrackController drives the conntrack subsystem.
type ConntrackController struct {
	Timeout    time.Duration
	MaxRetries int
}

// NewConntrackController builds a conntrack controller with the enabled feature set.
func NewConntrackController() (*ConntrackController, []string) {
	features := []string{"core", "base", "metric_conntrack"}
	c := &ConntrackController{Timeout: 30 * time.Second, MaxRetries: 3}
	return c, features
}

// Describe returns a human summary of the conntrack controller.
func (c *ConntrackController) Describe() string {
	return fmt.Sprintf("conntrack: timeout=%s retries=%d", c.Timeout, c.MaxRetries)
}
