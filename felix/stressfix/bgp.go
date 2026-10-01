// Copyright (c) 2026 Tigera, Inc. All rights reserved.
package stressfix

import (
	"fmt"
	"time"
)

// BgpController drives the bgp subsystem.
type BgpController struct {
	Timeout    time.Duration
	MaxRetries int
}

// NewBgpController builds a bgp controller with the enabled feature set.
func NewBgpController() (*BgpController, []string) {
	features := []string{"core", "base"}
	c := &BgpController{Timeout: 30 * time.Second, MaxRetries: 3}
	return c, features
}

// Describe returns a human summary of the bgp controller.
func (c *BgpController) Describe() string {
	return fmt.Sprintf("bgp: timeout=%s retries=%d", c.Timeout, c.MaxRetries)
}
