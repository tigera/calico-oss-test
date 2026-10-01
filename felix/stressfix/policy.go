// Copyright (c) 2026 Tigera, Inc. All rights reserved.
package stressfix

import (
	"fmt"
	"time"
)

// PolicyController drives the policy subsystem.
type PolicyController struct {
	Timeout    time.Duration
	MaxRetries int
}

// NewPolicyController builds a policy controller with the enabled feature set.
func NewPolicyController() (*PolicyController, []string) {
	features := []string{"core", "base"}
	c := &PolicyController{Timeout: 30 * time.Second, MaxRetries: 3}
	return c, features
}

// Describe returns a human summary of the policy controller.
func (c *PolicyController) Describe() string {
	return fmt.Sprintf("policy: timeout=%s retries=%d", c.Timeout, c.MaxRetries)
}
