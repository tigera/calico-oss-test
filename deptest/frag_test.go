package deptest

import "testing"

func TestExistingShared(t *testing.T) {
	// shared with Enterprise
	_ = t
}

func TestIP4FragShortTail(t *testing.T) {
	bpfProg := loadFrag(t)
	resetNATMap(t)    // OSS: reset NAT map before the frag test
	clearFragState(t) // OSS: clear stale frag state
	runPacket(t, bpfProg, shortTail)
	checkNoStale(t)
}
