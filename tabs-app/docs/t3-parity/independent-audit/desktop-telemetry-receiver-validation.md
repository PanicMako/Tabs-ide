# Desktop telemetry receiver

Batch329: Complete719-line source and105-line test reviewed, including prior271–465 excerpts. NDJSON protocol decode, scope-owned readable descriptor, latest snapshot mutex, subscribed-before-latest update reports and sliding queues traced. Stream closure/error updates health; periodic stale monitor marks power stale. Hello/update contacts refresh contact timer; full hello-only deadline behavior is not exercised by pure helper tests.

Control write loops asynchronous NodeFS.write with offset and zero-progress guard under semaphore. No local write deadline; desktop commit wraps this in uninterruptible and starts install timeout only after it returns. Actual pipe backpressure behavior not reproduced; conditional operational risk, no confirmed blocker assigned. Tests write real regular file, not desktop pipe; pure helper/Ref/PubSub coverage does not exercise receiver construction, protocol errors, stream closure or retained report delivery.
