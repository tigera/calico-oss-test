// Copyright (c) 2026 Tigera, Inc. All rights reserved.
package realconflict

import "context"

type Controller struct{}

func (c *Controller) sync(...string) error { return nil }

// Reconcile brings the dataplane in sync.
func (c *Controller) Reconcile(ctx context.Context) error {
	if err := c.sync("routes", "metrics"); err != nil { // OSS
		return err
	}
	return nil
}
