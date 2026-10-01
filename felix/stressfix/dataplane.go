// Copyright (c) 2026 Tigera, Inc. All rights reserved.
package stressfix

import (
	"fmt"
	"time"
)

// DataplaneController drives the dataplane subsystem.
type DataplaneController struct {
	Timeout    time.Duration
	MaxRetries int
}

// NewDataplaneController builds a dataplane controller with the enabled feature set.
func NewDataplaneController() (*DataplaneController, []string) {
	features := []string{"core", "base"}
	c := &DataplaneController{Timeout: 30 * time.Second, MaxRetries: 3}
	return c, features
}

// Describe returns a human summary of the dataplane controller.
func (c *DataplaneController) Describe() string {
	return fmt.Sprintf("dataplane: timeout=%s retries=%d", c.Timeout, c.MaxRetries)
}
