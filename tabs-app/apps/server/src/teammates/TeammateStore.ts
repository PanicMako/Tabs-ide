import {
  type ProjectId,
  type Teammate,
  TeammateError,
  type TeammateId,
  type TeammateItem,
  type TeammateItemId,
  type TeammateMemoryFact,
  type TeammateMemoryFactId,
  type TeammateSuggestion,
  type TeammateSuggestionId,
  type ThreadId,
  ModelSelection,
  TeammateLookAround,
  TeammateNotify,
} from "@tabs/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export type TeammateThreadKind = "home" | "look-around" | "worker";

export interface TeammateThreadLink {
  readonly threadId: ThreadId;
  readonly teammateId: TeammateId;
  readonly kind: TeammateThreadKind;
  readonly itemId: TeammateItemId | null;
  readonly createdAt: string;
}

type Fail = TeammateError;

export class TeammateStore extends Context.Service<
  TeammateStore,
  {
    readonly listTeammates: Effect.Effect<ReadonlyArray<Teammate>, Fail>;
    readonly getTeammate: (id: TeammateId) => Effect.Effect<Teammate | null, Fail>;
    /** Insert or fully replace. */
    readonly putTeammate: (teammate: Teammate) => Effect.Effect<void, Fail>;
    /** Removes the teammate and everything it owns; returns the threads it had. */
    readonly deleteTeammate: (
      id: TeammateId,
    ) => Effect.Effect<ReadonlyArray<TeammateThreadLink>, Fail>;

    readonly listItems: Effect.Effect<ReadonlyArray<TeammateItem>, Fail>;
    readonly getItem: (id: TeammateItemId) => Effect.Effect<TeammateItem | null, Fail>;
    readonly putItem: (item: TeammateItem) => Effect.Effect<void, Fail>;

    readonly listSuggestions: Effect.Effect<ReadonlyArray<TeammateSuggestion>, Fail>;
    readonly getSuggestion: (
      id: TeammateSuggestionId,
    ) => Effect.Effect<TeammateSuggestion | null, Fail>;
    /** False when a suggestion with the same dedupe key already exists in any status. */
    readonly insertSuggestionIfNew: (
      suggestion: TeammateSuggestion,
      dedupeKey: string,
    ) => Effect.Effect<boolean, Fail>;
    readonly setSuggestionStatus: (
      id: TeammateSuggestionId,
      status: TeammateSuggestion["status"],
    ) => Effect.Effect<void, Fail>;
    /** Open suggestions beyond the newest `keep` are dropped when a look finishes. */
    readonly countOpenSuggestions: (teammateId: TeammateId) => Effect.Effect<number, Fail>;

    readonly listFacts: (
      teammateId: TeammateId,
    ) => Effect.Effect<ReadonlyArray<TeammateMemoryFact>, Fail>;
    readonly getFact: (id: TeammateMemoryFactId) => Effect.Effect<TeammateMemoryFact | null, Fail>;
    readonly insertFact: (fact: TeammateMemoryFact) => Effect.Effect<void, Fail>;
    readonly deleteFact: (id: TeammateMemoryFactId) => Effect.Effect<void, Fail>;

    readonly linkThread: (link: TeammateThreadLink) => Effect.Effect<void, Fail>;
    readonly getThreadLink: (threadId: ThreadId) => Effect.Effect<TeammateThreadLink | null, Fail>;
    readonly listThreadLinks: Effect.Effect<ReadonlyArray<TeammateThreadLink>, Fail>;
  }
>()("tabs/teammates/TeammateStore") {}

const decodeModelSelection = Schema.decodeUnknownSync(ModelSelection);
const decodeLookAround = Schema.decodeUnknownSync(TeammateLookAround);
const decodeNotify = Schema.decodeUnknownSync(TeammateNotify);

interface TeammateRow {
  readonly teammate_id: string;
  readonly name: string;
  readonly finish: string;
  readonly model_selection_json: string | null;
  readonly project_id: string | null;
  readonly paused: number;
  readonly look_around_json: string;
  readonly notify_json: string;
  readonly home_thread_id: string | null;
  readonly last_look_around_at: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}
interface ItemRow {
  readonly item_id: string;
  readonly teammate_id: string;
  readonly title: string;
  readonly detail: string;
  readonly status: string;
  readonly worker_thread_ids_json: string;
  readonly question: string | null;
  readonly link: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}
interface SuggestionRow {
  readonly suggestion_id: string;
  readonly teammate_id: string;
  readonly title: string;
  readonly why: string;
  readonly ask: string;
  readonly link: string | null;
  readonly status: string;
  readonly created_at: string;
}
interface FactRow {
  readonly fact_id: string;
  readonly teammate_id: string;
  readonly text: string;
  readonly topic: string | null;
  readonly source: string;
  readonly created_at: string;
}
interface LinkRow {
  readonly thread_id: string;
  readonly teammate_id: string;
  readonly kind: string;
  readonly item_id: string | null;
  readonly created_at: string;
}

export const teammateFromRow = (row: TeammateRow): Teammate =>
  ({
    id: row.teammate_id,
    name: row.name,
    finish: row.finish,
    modelSelection:
      row.model_selection_json === null
        ? null
        : decodeModelSelection(JSON.parse(row.model_selection_json)),
    projectId: row.project_id as ProjectId | null,
    paused: row.paused !== 0,
    lookAround: decodeLookAround(JSON.parse(row.look_around_json)),
    notify: decodeNotify(JSON.parse(row.notify_json)),
    homeThreadId: row.home_thread_id,
    lastLookAroundAt: row.last_look_around_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }) as Teammate;

export const itemFromRow = (row: ItemRow): TeammateItem =>
  ({
    id: row.item_id,
    teammateId: row.teammate_id,
    title: row.title,
    detail: row.detail,
    status: row.status,
    workerThreadIds: JSON.parse(row.worker_thread_ids_json) as string[],
    question: row.question,
    link: row.link,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }) as unknown as TeammateItem;

const suggestionFromRow = (row: SuggestionRow): TeammateSuggestion =>
  ({
    id: row.suggestion_id,
    teammateId: row.teammate_id,
    title: row.title,
    why: row.why,
    ask: row.ask,
    link: row.link,
    status: row.status,
    createdAt: row.created_at,
  }) as TeammateSuggestion;

const factFromRow = (row: FactRow): TeammateMemoryFact =>
  ({
    id: row.fact_id,
    teammateId: row.teammate_id,
    text: row.text,
    topic: row.topic,
    source: row.source,
    createdAt: row.created_at,
  }) as TeammateMemoryFact;

const linkFromRow = (row: LinkRow): TeammateThreadLink =>
  ({
    threadId: row.thread_id,
    teammateId: row.teammate_id,
    kind: row.kind,
    itemId: row.item_id,
    createdAt: row.created_at,
  }) as TeammateThreadLink;

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const guard =
    (message: string) =>
    <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, TeammateError, R> =>
      effect.pipe(Effect.mapError((cause) => new TeammateError({ message, cause })));

  const decoding = <A>(message: string, read: () => A): Effect.Effect<A, TeammateError> =>
    Effect.try({ try: read, catch: (cause) => new TeammateError({ message, cause }) });

  const rows = <Row, A>(
    message: string,
    query: Effect.Effect<ReadonlyArray<Row>, unknown>,
    map: (row: Row) => A,
  ): Effect.Effect<ReadonlyArray<A>, TeammateError> =>
    query.pipe(
      guard(message),
      Effect.flatMap((found) => decoding(message, () => found.map(map))),
    );

  const one = <Row, A>(
    message: string,
    query: Effect.Effect<ReadonlyArray<Row>, unknown>,
    map: (row: Row) => A,
  ): Effect.Effect<A | null, TeammateError> =>
    rows(message, query, map).pipe(Effect.map((found) => found[0] ?? null));

  const listTeammates = rows(
    "Could not list teammates.",
    sql<TeammateRow>`SELECT * FROM teammates ORDER BY created_at ASC, rowid ASC`,
    teammateFromRow,
  );

  const putTeammate: TeammateStore["Service"]["putTeammate"] = (t) =>
    sql`
      INSERT INTO teammates (
        teammate_id, name, finish, model_selection_json, project_id, paused,
        look_around_json, notify_json, home_thread_id, last_look_around_at, created_at, updated_at
      ) VALUES (
        ${t.id}, ${t.name}, ${t.finish},
        ${t.modelSelection === null ? null : JSON.stringify(t.modelSelection)},
        ${t.projectId}, ${t.paused ? 1 : 0},
        ${JSON.stringify(t.lookAround)}, ${JSON.stringify(t.notify)},
        ${t.homeThreadId}, ${t.lastLookAroundAt}, ${t.createdAt}, ${t.updatedAt}
      )
      ON CONFLICT (teammate_id) DO UPDATE SET
        name = excluded.name,
        finish = excluded.finish,
        model_selection_json = excluded.model_selection_json,
        project_id = excluded.project_id,
        paused = excluded.paused,
        look_around_json = excluded.look_around_json,
        notify_json = excluded.notify_json,
        home_thread_id = excluded.home_thread_id,
        last_look_around_at = excluded.last_look_around_at,
        updated_at = excluded.updated_at
    `.pipe(guard("Could not save the teammate."), Effect.asVoid);

  const listThreadLinks = rows(
    "Could not list teammate threads.",
    sql<LinkRow>`SELECT * FROM teammate_threads ORDER BY created_at ASC, rowid ASC`,
    linkFromRow,
  );

  return TeammateStore.of({
    listTeammates,
    getTeammate: (id) =>
      one(
        "Could not read the teammate.",
        sql<TeammateRow>`SELECT * FROM teammates WHERE teammate_id = ${id}`,
        teammateFromRow,
      ),
    putTeammate,
    deleteTeammate: (id) =>
      Effect.gen(function* () {
        const links = yield* rows(
          "Could not read the teammate's threads.",
          sql<LinkRow>`SELECT * FROM teammate_threads WHERE teammate_id = ${id}`,
          linkFromRow,
        );
        yield* sql
          .withTransaction(
            Effect.gen(function* () {
              yield* sql`DELETE FROM teammate_threads WHERE teammate_id = ${id}`;
              yield* sql`DELETE FROM teammate_memory_facts WHERE teammate_id = ${id}`;
              yield* sql`DELETE FROM teammate_suggestions WHERE teammate_id = ${id}`;
              yield* sql`DELETE FROM teammate_items WHERE teammate_id = ${id}`;
              yield* sql`DELETE FROM teammates WHERE teammate_id = ${id}`;
            }),
          )
          .pipe(guard("Could not delete the teammate."));
        return links;
      }),

    listItems: rows(
      "Could not list items.",
      sql<ItemRow>`SELECT * FROM teammate_items ORDER BY created_at ASC, rowid ASC`,
      itemFromRow,
    ),
    getItem: (id) =>
      one(
        "Could not read the item.",
        sql<ItemRow>`SELECT * FROM teammate_items WHERE item_id = ${id}`,
        itemFromRow,
      ),
    putItem: (item) =>
      sql`
        INSERT INTO teammate_items (
          item_id, teammate_id, title, detail, status, worker_thread_ids_json,
          question, link, created_at, updated_at
        ) VALUES (
          ${item.id}, ${item.teammateId}, ${item.title}, ${item.detail}, ${item.status},
          ${JSON.stringify(item.workerThreadIds)}, ${item.question}, ${item.link},
          ${item.createdAt}, ${item.updatedAt}
        )
        ON CONFLICT (item_id) DO UPDATE SET
          title = excluded.title,
          detail = excluded.detail,
          status = excluded.status,
          worker_thread_ids_json = excluded.worker_thread_ids_json,
          question = excluded.question,
          link = excluded.link,
          updated_at = excluded.updated_at
      `.pipe(guard("Could not save the item."), Effect.asVoid),

    listSuggestions: rows(
      "Could not list suggestions.",
      sql<SuggestionRow>`SELECT * FROM teammate_suggestions ORDER BY created_at ASC, rowid ASC`,
      suggestionFromRow,
    ),
    getSuggestion: (id) =>
      one(
        "Could not read the suggestion.",
        sql<SuggestionRow>`SELECT * FROM teammate_suggestions WHERE suggestion_id = ${id}`,
        suggestionFromRow,
      ),
    insertSuggestionIfNew: (s, dedupeKey) =>
      sql<{ suggestion_id: string }>`
        INSERT INTO teammate_suggestions (
          suggestion_id, teammate_id, title, why, ask, link, dedupe_key, status, created_at
        ) VALUES (
          ${s.id}, ${s.teammateId}, ${s.title}, ${s.why}, ${s.ask}, ${s.link},
          ${dedupeKey}, ${s.status}, ${s.createdAt}
        )
        ON CONFLICT (teammate_id, dedupe_key) DO NOTHING
        RETURNING suggestion_id
      `.pipe(
        guard("Could not save the suggestion."),
        Effect.map((inserted) => inserted.length > 0),
      ),
    setSuggestionStatus: (id, status) =>
      sql`UPDATE teammate_suggestions SET status = ${status} WHERE suggestion_id = ${id}`.pipe(
        guard("Could not update the suggestion."),
        Effect.asVoid,
      ),
    countOpenSuggestions: (teammateId) =>
      sql<{ n: number }>`
        SELECT COUNT(*) AS n FROM teammate_suggestions
        WHERE teammate_id = ${teammateId} AND status = 'open'
      `.pipe(
        guard("Could not count suggestions."),
        Effect.map((found) => Number(found[0]?.n ?? 0)),
      ),

    listFacts: (teammateId) =>
      rows(
        "Could not list memory.",
        sql<FactRow>`
          SELECT * FROM teammate_memory_facts WHERE teammate_id = ${teammateId}
          ORDER BY created_at ASC, rowid ASC
        `,
        factFromRow,
      ),
    getFact: (id) =>
      one(
        "Could not read the memory fact.",
        sql<FactRow>`SELECT * FROM teammate_memory_facts WHERE fact_id = ${id}`,
        factFromRow,
      ),
    insertFact: (fact) =>
      sql`
        INSERT INTO teammate_memory_facts (fact_id, teammate_id, text, topic, source, created_at)
        VALUES (${fact.id}, ${fact.teammateId}, ${fact.text}, ${fact.topic}, ${fact.source}, ${fact.createdAt})
      `.pipe(guard("Could not save the memory fact."), Effect.asVoid),
    deleteFact: (id) =>
      sql`DELETE FROM teammate_memory_facts WHERE fact_id = ${id}`.pipe(
        guard("Could not forget the memory fact."),
        Effect.asVoid,
      ),

    linkThread: (link) =>
      sql`
        INSERT INTO teammate_threads (thread_id, teammate_id, kind, item_id, created_at)
        VALUES (${link.threadId}, ${link.teammateId}, ${link.kind}, ${link.itemId}, ${link.createdAt})
        ON CONFLICT (thread_id) DO UPDATE SET
          teammate_id = excluded.teammate_id, kind = excluded.kind, item_id = excluded.item_id
      `.pipe(guard("Could not link the thread."), Effect.asVoid),
    getThreadLink: (threadId) =>
      one(
        "Could not read the thread link.",
        sql<LinkRow>`SELECT * FROM teammate_threads WHERE thread_id = ${threadId}`,
        linkFromRow,
      ),
    listThreadLinks,
  });
});

export const layer = Layer.effect(TeammateStore, make);
