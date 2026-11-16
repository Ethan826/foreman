#include <stdio.h>
#include <time.h>
int main(void){ printf("%llu\n",(unsigned long long)clock_gettime_nsec_np(CLOCK_MONOTONIC)); return 0; }
