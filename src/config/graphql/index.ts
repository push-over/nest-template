import { Injectable, Logger } from '@nestjs/common'
import { GqlOptionsFactory, GqlModuleOptions } from '@nestjs/graphql'
import { MemcachedCache } from 'apollo-server-cache-memcached'
import { PubSub } from 'graphql-subscriptions'
import { AuthenticationError, GraphQLRequestContext } from 'apollo-server-core'
import { MockList } from 'graphql-tools'
import GraphQLJSON, { GraphQLJSONObject } from 'graphql-type-json'
import * as depthLimit from 'graphql-depth-limit'
import chalk from 'chalk'

import schemaDirectives from './schemaDirectives'
import directiveResolvers from './directiveResolvers'

import {
	NODE_ENV,
	PRIMARY_COLOR,
	END_POINT,
	FE_URL,
	GRAPHQL_DEPTH_LIMIT
} from '@environments'

const pubsub = new PubSub()

const MyRequestDidStartPlugin = {
  requestDidStart(requestContext: GraphQLRequestContext) {
    return {
			willSendResponse(requestContext) {
				const { context, response } = requestContext
				context.trackErrors(response.errors)
				return requestContext
			}
		}
  }
}

@Injectable()
export class GraphqlService implements GqlOptionsFactory {
	async createGqlOptions(): Promise<GqlModuleOptions> {
		return {
			typePaths: ['./**/*.graphql'],
			resolvers: {
				JSON: GraphQLJSON,
				JSONObject: GraphQLJSONObject
			},
			plugins: [MyRequestDidStartPlugin],
			mocks: NODE_ENV === 'testing' && {
				// String: () => 'Chnirt',
				Query: () => ({
					users: () => new MockList([2, 6])
				})
			},
			resolverValidationOptions: {
				requireResolversForResolveType: false
			},
			path: `/${END_POINT!}`,
			cors:
				NODE_ENV === 'production'
					? {
							origin: FE_URL!,
							credentials: true // <-- REQUIRED backend setting
					  }
					: true,
			bodyParserConfig: { limit: '50mb' },
			onHealthCheck: () => {
				console.log('onHealthCheck')
				return new Promise((resolve, reject) => {
					// Replace the `true` in this conditional with more specific checks!
					if (true) {
						resolve()
					} else {
						reject()
					}
				})
			},
			schemaDirectives,
			directiveResolvers,
			validationRules: [
				depthLimit(
					GRAPHQL_DEPTH_LIMIT!,
					{ ignore: [/_trusted$/, 'idontcare'] },
					(depths) => {
						if (depths[''] === GRAPHQL_DEPTH_LIMIT! - 1) {
							Logger.warn(
								`⚠️  You can only descend ${chalk
									.hex(PRIMARY_COLOR!)
									.bold(`${GRAPHQL_DEPTH_LIMIT!}`)} levels.`,
								'GraphQL',
								false
							)
						}
					}
				)
			],
			introspection: true,
			playground: NODE_ENV !== 'production' && {
				settings: {
					'editor.cursorShape': 'underline', // possible values: 'line', 'block', 'underline'
					'editor.fontFamily': `'Source Code Pro', 'Consolas', 'Inconsolata', 'Droid Sans Mono', 'Monaco', monospace`,
					'editor.fontSize': 16,
					'editor.reuseHeaders': true, // new tab reuses headers from last tab
					'editor.theme': 'dark', // possible values: 'dark', 'light'
					'general.betaUpdates': true,
					'queryPlan.hideQueryPlanResponse': false,
					'request.credentials': 'include', // possible values: 'omit', 'include', 'same-origin'
					'tracing.hideTracingResponse': true
				}
				// tabs: [
				// 	{
				// 		endpoint: END_POINT,
				// 		query: '{ hello }'
				// 	}
				// ]
			},
			tracing: NODE_ENV !== 'production',
			cacheControl: NODE_ENV === 'production' && {
				defaultMaxAge: 5,
				stripFormattedExtensions: false,
				calculateHttpHeaders: false
			},
			context: async ({ req, res, connection }) => {
				if (connection) {
					const { currentUser } = connection.context
					return {
						pubsub,
						currentUser
					}
				}

				let currentUser = 'ACCESS_TOKEN'

				return {
					req,
					res,
					pubsub,
					currentUser,
					trackErrors(errors) {
						// Track the errors
						// console.log(errors)
					}
				}
			},
			formatError: (error) => {
				return {
					message: error.message,
					code: error.extensions && error.extensions.code,
					locations: error.locations,
					path: error.path
				}
			},
			formatResponse: (response) => {
				return response
			},
			subscriptions: {
				path: `/${END_POINT!}`,
				keepAlive: 1000,
				onConnect: async (connectionParams, webSocket, context) => {
					NODE_ENV !== 'production' &&
						Logger.debug(`🔗  Connected to websocket`, 'GraphQL')

					throw new AuthenticationError(
						'Authentication token is invalid, please try again.'
					)
				},
				onDisconnect: async (webSocket, context) => {
					NODE_ENV !== 'production' &&
						Logger.error(`❌  Disconnected to websocket`, '', 'GraphQL', false)
				}
			},
			persistedQueries: {
				cache: new MemcachedCache(
					['memcached-server-1', 'memcached-server-2', 'memcached-server-3'],
					{ retries: 10, retry: 10000 } // Options
				)
			},
			installSubscriptionHandlers: true,
			uploads: {
				maxFieldSize: 2, // 1mb
				maxFileSize: 20, // 20mb
				maxFiles: 5
			}
		}
	}
}
