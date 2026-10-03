import { Stream, Effect } from "effect";
Stream.fromIterable([1, 2, 3]).pipe(Stream.runForEach(console.log));
