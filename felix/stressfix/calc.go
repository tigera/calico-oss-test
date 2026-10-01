// Copyright (c) 2026 Tigera, Inc. All rights reserved.
package stressfix

import (
	"fmt"
	"time"
)

// CalcController drives the calc subsystem.
type CalcController struct {
	Timeout    time.Duration
	MaxRetries int
}

// NewCalcController builds a calc controller with the enabled feature set.
func NewCalcController() (*CalcController, []string) {
	features := []string{"core", "base", "metric_calc"}
	c := &CalcController{Timeout: 30 * time.Second, MaxRetries: 3}
	return c, features
}

// Describe returns a human summary of the calc controller.
func (c *CalcController) Describe() string {
	return fmt.Sprintf("calc: timeout=%s retries=%d", c.Timeout, c.MaxRetries)
}
