const { ApolloServer, gql } = require('apollo-server');
const fetch = require('node-fetch');
const parsePrometheusTextFormat = require('parse-prometheus-text-format');
const { createPlugin: createPromsterMetricsPlugin } = require('./plugin');
const {
  createServer: createPrometheusMetricsServer,
} = require('@promster/server');

async function startServer() {
  const typeDefs = gql`
    type Book {
      title: String
      author: String
    }

    type Query {
      books: [Book]
    }
  `;

  const books = [
    {
      title: 'The Awakening',
      author: 'Kate Chopin',
    },
    {
      title: 'City of Glass',
      author: 'Paul Auster',
    },
  ];

  const resolvers = {
    Query: {
      books: () => books,
    },
  };

  const server = new ApolloServer({
    typeDefs,
    resolvers,
    plugins: [createPromsterMetricsPlugin()],
  });

  const prometheusMetricsServer = await createPrometheusMetricsServer({
    port: 1337,
    detectKubernetes: false,
  });

  await server.listen({
    port: 3000,
  });

  return {
    close: async () =>
      Promise.all([
        server.stop(),
        new Promise((resolve, reject) => {
          prometheusMetricsServer.close((err) => {
            if (err) {
              reject(err);

              return;
            }

            resolve();
          });
        }),
      ]),
    app,
  };
}

let app;
let closeServers;

beforeAll(async () => {
  const startedServer = await startServer();

  app = startedServer.app;
  closeServers = startedServer.close;
});

afterAll(async () => {
  await closeServers();
});

it('should up metric', async () => {
  const response = await fetch('http://0.0.0.0:1337');
  const rawMetrics = await response.text();

  const parsedMetrics = parsePrometheusTextFormat(rawMetrics);

  expect(parsedMetrics).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        name: 'up',
      }),
    ])
  );
});

it('should expose garbage collection metrics', async () => {
  const response = await fetch('http://0.0.0.0:1337');
  const rawMetrics = await response.text();

  const parsedMetrics = parsePrometheusTextFormat(rawMetrics);

  expect(parsedMetrics).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        name: 'process_cpu_user_seconds_total',
      }),
      expect.objectContaining({
        name: 'process_cpu_system_seconds_total',
      }),
      expect.objectContaining({
        name: 'process_cpu_seconds_total',
      }),
      expect.objectContaining({
        name: 'process_start_time_seconds',
      }),
      expect.objectContaining({
        name: 'process_resident_memory_bytes',
      }),
      expect.objectContaining({
        name: 'nodejs_eventloop_lag_seconds',
      }),
      expect.objectContaining({
        name: 'nodejs_gc_runs_total',
      }),
      expect.objectContaining({
        name: 'nodejs_gc_duration_seconds',
      }),
      expect.objectContaining({
        name: 'nodejs_eventloop_lag_max_seconds',
      }),
      expect.objectContaining({
        name: 'nodejs_eventloop_lag_p50_seconds',
      }),
      expect.objectContaining({
        name: 'nodejs_version_info',
      }),
    ])
  );
});

it('should expose GraphQL metrics', async () => {
  const response = await fetch('http://0.0.0.0:1337');
  const rawMetrics = await response.text();

  const parsedMetrics = parsePrometheusTextFormat(rawMetrics);

  expect(parsedMetrics).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        name: 'graphql_errors_total',
      }),
      expect.objectContaining({
        name: 'graphql_request_duration_seconds',
      }),
      expect.objectContaining({
        name: 'graphql_resolve_field_duration_seconds',
      }),
      expect.objectContaining({
        name: 'graphql_validation_duration_seconds',
      }),
      expect.objectContaining({
        name: 'graphql_parse_duration_seconds',
      }),
    ])
  );
});

it('should record GraphQL metrics for successful requests', async () => {
  await fetch('http://0.0.0.0:3000', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: `
          query MyBooks {
            books {
              title
            }
          }
        `,
    }),
  });

  const response = await fetch('http://0.0.0.0:1337');
  const rawMetrics = await response.text();

  const parsedMetrics = parsePrometheusTextFormat(rawMetrics);
  const graphQlRequestDurationSeconds = parsedMetrics.find(
    (metric) => metric.name === 'graphql_request_duration_seconds'
  ).metrics;

  expect(graphQlRequestDurationSeconds).toMatchInlineSnapshot(`
    Array [
      Object {
        "buckets": Object {
          "+Inf": "1",
          "0.5": "1",
          "0.9": "1",
          "0.95": "1",
          "0.98": "1",
          "0.99": "1",
        },
      },
    ]
  `);

  const graphQlResolveFieldDurationSeconds = parsedMetrics.find(
    (metric) => metric.name === 'graphql_resolve_field_duration_seconds'
  ).metrics;

  expect(graphQlResolveFieldDurationSeconds).toMatchInlineSnapshot(`
    Array [
      Object {
        "buckets": Object {
          "+Inf": "2",
          "0.5": "2",
          "0.9": "2",
          "0.95": "2",
          "0.98": "2",
          "0.99": "2",
        },
      },
    ]
  `);
});

it('should record GraphQL metrics for failed requests', async () => {
  await fetch('http://0.0.0.0:3000', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: `
          query MyBooks {
            books {
              titles
            }
          }
        `,
    }),
  });

  const response = await fetch('http://0.0.0.0:1337');
  const rawMetrics = await response.text();

  const parsedMetrics = parsePrometheusTextFormat(rawMetrics);
  const graphQlErrorsTotal = parsedMetrics.find(
    (metric) => metric.name === 'graphql_errors_total'
  ).metrics;

  expect(graphQlErrorsTotal).toMatchInlineSnapshot(`
    Array [
      Object {
        "labels": Object {
          "operation_name": "undefined",
          "phase": "validation",
        },
        "value": "1",
      },
    ]
  `);
});
