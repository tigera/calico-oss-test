// Copyright (c) 2026 Tigera, Inc. All rights reserved.
package realconflict

import (
	"github.com/projectcalico/calico/felix/ip"
	"github.com/projectcalico/calico/felix/nftables" // new in OSS
)

// Dataplane drives the Linux dataplane.
type Dataplane struct{ ipSets *ip.Set }
