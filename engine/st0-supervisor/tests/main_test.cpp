// main_test.cpp — the supervisor's unit tests, one binary: each file registers a `run*Tests()` that
// RUNs its cases. No device, no network, no engine — what needs those is exercised by hand.

#include "test_harness.h"

void runUrlTests();
void runSettingsTests();
void runHostProtocolTests();

int main()
{
    runUrlTests();
    runSettingsTests();
    runHostProtocolTests();
    TEST_MAIN_END();
}
