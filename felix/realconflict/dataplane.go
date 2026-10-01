// Copyright (c) 2026 Tigera, Inc. All rights reserved.
package realconflict

import (
	"github.com/projectcalico/calico/felix/ip"
)

// Dataplane drives the Linux dataplane.
type Dataplane struct{ ipSets *ip.Set }
