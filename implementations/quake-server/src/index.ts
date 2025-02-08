#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import axios from 'axios';

const QUAKE_API_KEY = process.env.QUAKE_API_KEY;
if (!QUAKE_API_KEY) {
  throw new Error('QUAKE_API_KEY environment variable is required');
}

interface QuakeSearchParams {
  query: string;
  start?: number;
  size?: number;
  ignore_cache?: boolean;
  start_time?: string;
  end_time?: string;
  include?: string[];
  exclude?: string[];
  latest?: boolean;
  shortcuts?: string[];
}

// 用于验证和类型转换的工具函数
const isValidSearchArguments = (obj: unknown): obj is QuakeSearchParams => {
  if (!obj || typeof obj !== 'object') return false;
  const args = obj as Record<string, unknown>;
  return typeof args.query === 'string';
};

const DEFAULT_INCLUDE_FIELDS = [
  'ip',
  'port',
  'asn',
  'service.name',
  'service.http.title',
  'service.http.server',
  'domain',
  'service.http.status_code'
];

class QuakeServer {
  private server: Server;
  private axiosInstance;

  constructor() {
    this.server = new Server(
      {
        name: 'quake-server',
        version: '0.1.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.axiosInstance = axios.create({
      baseURL: 'https://quake.360.net/api/v3',
      headers: {
        'X-QuakeToken': QUAKE_API_KEY,
        'Content-Type': 'application/json',
      },
    });

    this.setupToolHandlers();
    
    this.server.onerror = (error: Error) => console.error('[MCP Error]', error);
    process.on('SIGINT', async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  private getQuerySyntaxHelp(): string {
    return `Quake 查询语法指南:

1. IP搜索:
- 单个IP: ip:"1.1.1.1"
- CIDR地址段: ip:"1.1.1.1/16"
- IPv6地址: ip:"2804:29b8:500d:4184:40a8:2e48:9a5d:e2bd"

2. 域名搜索:
- 精确域名: domain:"360.cn"
- 泛域名: domain:*.360.cn

3. 应用搜索:
- 产品名称: app:"Apache"

4. 响应内容搜索:
- 端口响应: response:"奇虎科技"
- 特定服务响应: response:"220 ProFTPD 1.3.5a Server"

5. 网页内容搜索:
- 网页标题: title:"后台"
- 网页正文: body:"奇虎"

6. 其他搜索:
- 邮箱地址: mail:"@163.com"

高级搜索支持:
- 过滤无效请求
- 排除蜜罐
- 排除CDN
- 时间范围过滤
- 自定义字段包含/排除`;
  }

  private setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'get_syntax_help',
          description: '获取 Quake 查询语法帮助',
          inputSchema: {
            type: 'object',
            properties: {},
            additionalProperties: false,
          },
        },
        {
          name: 'search',
          description: '使用 Quake 搜索服务',
          inputSchema: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: '查询语句',
              },
              start: {
                type: 'number',
                description: '返回结果的起始位置',
                minimum: 0,
              },
              size: {
                type: 'number',
                description: '返回结果的数量（默认20，可选1-100）',
                minimum: 1,
                maximum: 100,
              },
              ignore_cache: {
                type: 'boolean',
                description: '是否忽略缓存',
              },
              start_time: {
                type: 'string',
                description: '查询起始时间 (UTC)',
                format: 'date-time',
              },
              end_time: {
                type: 'string',
                description: '查询结束时间 (UTC)',
                format: 'date-time',
              },
              include: {
                type: 'array',
                items: {
                  type: 'string',
                },
                description: '包含的字段列表',
              },
              exclude: {
                type: 'array',
                items: {
                  type: 'string',
                },
                description: '排除的字段列表',
              },
              latest: {
                type: 'boolean',
                description: '是否使用最新数据',
              },
              shortcuts: {
                type: 'array',
                items: {
                  type: 'string',
                },
                description: '快捷过滤器ID列表',
              },
            },
            required: ['query'],
            additionalProperties: false,
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      switch (request.params.name) {
        case 'get_syntax_help':
          return {
            content: [
              {
                type: 'text',
                text: this.getQuerySyntaxHelp(),
              },
            ],
          };

        case 'search': {
          if (!request.params.arguments || typeof request.params.arguments !== 'object') {
            throw new McpError(ErrorCode.InvalidParams, 'Invalid arguments');
          }

          if (!isValidSearchArguments(request.params.arguments)) {
            throw new McpError(ErrorCode.InvalidParams, 'Invalid search arguments format');
          }

          const args = request.params.arguments;

          try {
            const params: QuakeSearchParams = {
              query: args.query,
              start: typeof args.start === 'number' ? args.start : 0,
              size: typeof args.size === 'number' ? args.size : 20, // 修改默认值为20
              ignore_cache: typeof args.ignore_cache === 'boolean' ? args.ignore_cache : false,
              start_time: typeof args.start_time === 'string' ? args.start_time : undefined,
              end_time: typeof args.end_time === 'string' ? args.end_time : undefined,
              include: Array.isArray(args.include) ? args.include : DEFAULT_INCLUDE_FIELDS,
              exclude: Array.isArray(args.exclude) ? args.exclude : undefined,
              latest: typeof args.latest === 'boolean' ? args.latest : false,
              shortcuts: Array.isArray(args.shortcuts) ? args.shortcuts : undefined,
            };

            const response = await this.axiosInstance.post('/search/quake_service', params);
            
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(response.data, null, 2),
                },
              ],
            };
          } catch (error) {
            if (axios.isAxiosError(error)) {
              throw new McpError(
                ErrorCode.InternalError,
                `Quake API error: ${error.response?.data?.message || error.message}`
              );
            }
            throw new McpError(ErrorCode.InternalError, 'Unknown error occurred');
          }
        }

        default:
          throw new McpError(
            ErrorCode.MethodNotFound,
            `Unknown tool: ${request.params.name}`
          );
      }
    });
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Quake MCP server running on stdio');
  }
}

const server = new QuakeServer();
server.run().catch(console.error);
