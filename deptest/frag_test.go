package deptest

import "testing"

func TestExistingShared(t *testing.T) {
	// shared with Enterprise
	_ = t
}

func TestIP4FragShortTail(t *testing.T) {
	bpfProg := loadFrag(t)
	runPacket(t, bpfProg, shortTail)
	checkNoStale(t)
}
