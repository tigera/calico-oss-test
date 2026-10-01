// Copyright (c) 2026 Tigera, Inc. All rights reserved.
package stressfix

import (
	"fmt"
	"time"
)

// WireguardController drives the wireguard subsystem.
type WireguardController struct {
	Timeout    time.Duration
	MaxRetries int
}

// NewWireguardController builds a wireguard controller with the enabled feature set.
func NewWireguardController() (*WireguardController, []string) {
	features := []string{"core", "base", "metric_wireguard"}
	c := &WireguardController{Timeout: 30 * time.Second, MaxRetries: 3}
	return c, features
}

// Describe returns a human summary of the wireguard controller.
func (c *WireguardController) Describe() string {
	return fmt.Sprintf("wireguard: timeout=%s retries=%d", c.Timeout, c.MaxRetries)
}
