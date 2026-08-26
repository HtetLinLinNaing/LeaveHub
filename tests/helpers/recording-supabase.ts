import type { SupabaseClient } from "@supabase/supabase-js";

export type RecordedOperation = {
  method: string;
  args: unknown[];
};

export type RecordedQuery = {
  table: string;
  operations: RecordedOperation[];
};

export type RecordingResponse = {
  success: boolean;
  data: unknown;
  error: Error | null;
  count: number | null;
  status: number;
  statusText: string;
};

type ResponseResolver = (
  query: RecordedQuery
) => RecordingResponse | Promise<RecordingResponse>;

class RecordingQuery implements PromiseLike<RecordingResponse> {
  private readonly operations: RecordedOperation[] = [];

  constructor(
    private readonly table: string,
    private readonly queries: RecordedQuery[],
    private readonly resolveResponse: ResponseResolver
  ) {}

  select(...args: unknown[]) {
    return this.record("select", args);
  }

  eq(...args: unknown[]) {
    return this.record("eq", args);
  }

  in(...args: unknown[]) {
    return this.record("in", args);
  }

  gte(...args: unknown[]) {
    return this.record("gte", args);
  }

  lte(...args: unknown[]) {
    return this.record("lte", args);
  }

  order(...args: unknown[]) {
    return this.record("order", args);
  }

  limit(...args: unknown[]) {
    return this.record("limit", args);
  }

  range(...args: unknown[]) {
    return this.record("range", args);
  }

  then<TResult1 = RecordingResponse, TResult2 = never>(
    onfulfilled?:
      | ((value: RecordingResponse) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    const query = {
      table: this.table,
      operations: this.operations.map((operation) => ({
        method: operation.method,
        args: [...operation.args],
      })),
    };
    this.queries.push(query);
    return Promise.resolve(this.resolveResponse(query)).then(
      onfulfilled,
      onrejected
    );
  }

  private record(method: string, args: unknown[]) {
    this.operations.push({ method, args });
    return this;
  }
}

export function createRecordingSupabase(resolveResponse: ResponseResolver): {
  db: SupabaseClient;
  queries: RecordedQuery[];
} {
  const queries: RecordedQuery[] = [];
  const db = {
    from(table: string) {
      return new RecordingQuery(table, queries, resolveResponse);
    },
  } as unknown as SupabaseClient;

  return { db, queries };
}

export function successfulResponse(data: unknown): RecordingResponse {
  return {
    success: true,
    data,
    error: null,
    count: null,
    status: 200,
    statusText: "OK",
  };
}

export function failedResponse(error: Error): RecordingResponse {
  return {
    success: false,
    data: null,
    error,
    count: null,
    status: 500,
    statusText: "Internal Server Error",
  };
}

export function hasOperation(
  query: RecordedQuery,
  method: string,
  ...args: unknown[]
) {
  return query.operations.some(
    (operation) =>
      operation.method === method &&
      JSON.stringify(operation.args) === JSON.stringify(args)
  );
}
