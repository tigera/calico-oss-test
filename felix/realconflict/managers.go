// Copyright (c) 2026 Tigera, Inc. All rights reserved.
package realconflict

type manager interface{ OnUpdate() }
func newPolicyManager() manager  { return nil }
func newRouteManager() manager   { return nil }
func newFlowLogManager() manager { return nil }
func newNFTablesManager() manager{ return nil }

// allManagers returns the enabled managers.
func allManagers() []manager {
	return []manager{
		newPolicyManager(),
		newRouteManager(),
	}
}
