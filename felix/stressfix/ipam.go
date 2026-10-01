// Copyright (c) 2026 Tigera, Inc. All rights reserved.
package stressfix

import (
	"fmt"
	"time"
)

// IpamController drives the ipam subsystem.
type IpamController struct {
	Timeout    time.Duration
	MaxRetries int
}

// NewIpamController builds a ipam controller with the enabled feature set.
func NewIpamController() (*IpamController, []string) {
	features := []string{"core", "base", "metric_ipam"}
	c := &IpamController{Timeout: 30 * time.Second, MaxRetries: 3}
	return c, features
}

// Describe returns a human summary of the ipam controller.
func (c *IpamController) Describe() string {
	return fmt.Sprintf("ipam: timeout=%s retries=%d", c.Timeout, c.MaxRetries)
}
