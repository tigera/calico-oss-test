// Copyright (c) 2026 Tigera, Inc. All rights reserved.
package stressfix

import (
	"fmt"
	"time"
)

// EndpointController drives the endpoint subsystem.
type EndpointController struct {
	Timeout    time.Duration
	MaxRetries int
}

// NewEndpointController builds a endpoint controller with the enabled feature set.
func NewEndpointController() (*EndpointController, []string) {
	features := []string{"core", "base", "metric_endpoint"}
	c := &EndpointController{Timeout: 30 * time.Second, MaxRetries: 3}
	return c, features
}

// Describe returns a human summary of the endpoint controller.
func (c *EndpointController) Describe() string {
	return fmt.Sprintf("endpoint: timeout=%s retries=%d", c.Timeout, c.MaxRetries)
}
