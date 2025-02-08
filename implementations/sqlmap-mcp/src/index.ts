#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

class SqlmapServer {
  private server: Server;

  constructor() {
    this.server = new Server(
      {
        name: 'sqlmap-server',
        version: '0.1.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupToolHandlers();
    
    this.server.onerror = (error: Error) => console.error('[MCP Error]', error);
    process.on('SIGINT', async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  private setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'scan_target',
          description: '使用sqlmap扫描目标URL进行SQL注入测试',
          inputSchema: {
            type: 'object',
            properties: {
              url: {
                type: 'string',
                description: '要扫描的目标URL',
              },
              method: {
                type: 'string',
                enum: ['GET', 'POST'],
                description: 'HTTP请求方法',
                default: 'GET'
              },
              data: {
                type: 'string',
                description: 'POST数据(如果使用POST方法)',
              },
              level: {
                type: 'number',
                minimum: 1,
                maximum: 5,
                description: '扫描等级(1-5)',
                default: 1
              },
              risk: {
                type: 'number',
                minimum: 1,
                maximum: 3,
                description: '风险等级(1-3)',
                default: 1
              },
              threads: {
                type: 'number',
                minimum: 1,
                maximum: 10,
                description: '并发线程数',
                default: 1
              }
            },
            required: ['url'],
            additionalProperties: false,
          },
        },
        {
          name: 'exploit_db',
          description: '使用sqlmap进行数据库信息收集和利用',
          inputSchema: {
            type: 'object',
            properties: {
              url: {
                type: 'string',
                description: '要利用的目标URL',
              },
              method: {
                type: 'string',
                enum: ['GET', 'POST'],
                description: 'HTTP请求方法',
                default: 'GET'
              },
              data: {
                type: 'string',
                description: 'POST数据(如果使用POST方法)',
              },
              action: {
                type: 'string',
                enum: [
                  'current-user',   // 获取当前用户
                  'current-db',     // 获取当前数据库
                  'dbs',           // 获取所有数据库
                  'tables',        // 获取指定数据库的表
                  'columns',       // 获取指定表的列
                  'dump'           // 导出数据
                ],
                description: '要执行的利用操作'
              },
              database: {
                type: 'string',
                description: '目标数据库名(用于tables/columns/dump操作)'
              },
              table: {
                type: 'string',
                description: '目标表名(用于columns/dump操作)'
              },
              columns: {
                type: 'array',
                items: {
                  type: 'string'
                },
                description: '要导出的列名数组(用于dump操作)'
              },
              limit: {
                type: 'number',
                minimum: 1,
                description: '导出数据的最大行数',
                default: 10
              }
            },
            required: ['url', 'action'],
            additionalProperties: false,
          },
        },
        {
          name: 'scan_from_file',
          description: '从请求文件中读取并进行SQL注入测试',
          inputSchema: {
            type: 'object',
            properties: {
              requestFile: {
                type: 'string',
                description: '包含HTTP请求的文件路径',
              },
              level: {
                type: 'number',
                minimum: 1,
                maximum: 5,
                description: '扫描等级(1-5)',
                default: 1
              },
              risk: {
                type: 'number',
                minimum: 1,
                maximum: 3,
                description: '风险等级(1-3)',
                default: 1
              },
              threads: {
                type: 'number',
                minimum: 1,
                maximum: 10,
                description: '并发线程数',
                default: 1
              }
            },
            required: ['requestFile'],
            additionalProperties: false,
          },
        },
        {
          name: 'search_database',
          description: '搜索数据库中的列名、表名或数据库名',
          inputSchema: {
            type: 'object',
            properties: {
              url: {
                type: 'string',
                description: '目标URL',
              },
              searchPattern: {
                type: 'string',
                description: '要搜索的模式（支持LIKE语法，例如：user%）',
              },
              method: {
                type: 'string',
                enum: ['GET', 'POST'],
                description: 'HTTP请求方法',
                default: 'GET'
              },
              data: {
                type: 'string',
                description: 'POST数据(如果使用POST方法)',
              }
            },
            required: ['url', 'searchPattern'],
            additionalProperties: false,
          },
        }
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request: any) => {
      if (request.params.name === 'scan_target') {
        return await this.handleScanTarget(request.params.arguments);
      } else if (request.params.name === 'exploit_db') {
        return await this.handleExploitDb(request.params.arguments);
      } else if (request.params.name === 'scan_from_file') {
        return await this.handleScanFromFile(request.params.arguments);
      } else if (request.params.name === 'search_database') {
        return await this.handleSearchDatabase(request.params.arguments);
      } else {
        throw new McpError(
          ErrorCode.MethodNotFound,
          `未知工具: ${request.params.name}`
        );
      }
    });
  }

  private async handleScanTarget(args: {
    url: string;
    method?: 'GET' | 'POST';
    data?: string;
    level?: number;
    risk?: number;
    threads?: number;
  }) {
    try {
      let command = `sqlmap -u "${args.url}"`;
      
      if (args.method === 'POST') {
        command += ` --method POST`;
        if (args.data) {
          command += ` --data "${args.data}"`;
        }
      }

      if (args.level) {
        command += ` --level ${args.level}`;
      }

      if (args.risk) {
        command += ` --risk ${args.risk}`;
      }

      if (args.threads) {
        command += ` --threads ${args.threads}`;
      }

      command += ' --batch --random-agent';

      const { stdout, stderr } = await execAsync(command);
      
      return {
        content: [
          {
            type: 'text',
            text: stdout + (stderr ? `\nErrors:\n${stderr}` : ''),
          },
        ],
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: 'text',
            text: `执行sqlmap时出错: ${errorMessage}`,
          },
        ],
        isError: true,
      };
    }
  }

  private async handleExploitDb(args: {
    url: string;
    method?: 'GET' | 'POST';
    data?: string;
    action: string;
    database?: string;
    table?: string;
    columns?: string[];
    limit?: number;  // 添加 limit 参数
  }) {
    try {
      let command = `sqlmap -u "${args.url}"`;

      if (args.method === 'POST') {
        command += ` --method POST`;
        if (args.data) {
          command += ` --data "${args.data}"`;
        }
      }

      // 添加相应的sqlmap参数
      switch (args.action) {
        case 'current-user':
          command += ' --current-user';
          break;
        case 'current-db':
          command += ' --current-db';
          break;
        case 'dbs':
          command += ' --dbs';
          break;
        case 'tables':
          if (!args.database) {
            throw new Error('获取表信息时需要指定数据库名');
          }
          command += ` -D "${args.database}" --tables`;
          break;
        case 'columns':
          if (!args.database || !args.table) {
            throw new Error('获取列信息时需要指定数据库名和表名');
          }
          command += ` -D "${args.database}" -T "${args.table}" --columns`;
          break;
        case 'dump':
          if (!args.database || !args.table) {
            throw new Error('导出数据时需要指定数据库名和表名');
          }
          command += ` -D "${args.database}" -T "${args.table}"`;
          if (args.columns && args.columns.length > 0) {
            command += ` -C "${args.columns.join(',')}"`;
          }
          command += ' --dump';
          if (args.limit) {
            command += ` --start 1 --stop ${args.limit}`;
          } else {
            command += ' --start 1 --stop 10';  // 默认限制为10条
          }
          break;
        default:
          throw new Error(`未知的操作类型: ${args.action}`);
      }

      command += ' --batch --random-agent';

      const { stdout, stderr } = await execAsync(command);
      
      return {
        content: [
          {
            type: 'text',
            text: stdout + (stderr ? `\nErrors:\n${stderr}` : ''),
          },
        ],
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: 'text',
            text: `执行sqlmap时出错: ${errorMessage}`,
          },
        ],
        isError: true,
      };
    }
  }

  private async handleScanFromFile(args: {
      requestFile: string;
      level?: number;
      risk?: number;
      threads?: number;
    }) {
      try {
        let command = `sqlmap -r "${args.requestFile}"`;
  
        if (args.level) {
          command += ` --level ${args.level}`;
        }
  
        if (args.risk) {
          command += ` --risk ${args.risk}`;
        }
  
        if (args.threads) {
          command += ` --threads ${args.threads}`;
        }
  
        command += ' --batch --random-agent';
  
        const { stdout, stderr } = await execAsync(command);
        
        return {
          content: [
            {
              type: 'text',
              text: stdout + (stderr ? `\nErrors:\n${stderr}` : ''),
            },
          ],
        };
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: 'text',
              text: `执行sqlmap时出错: ${errorMessage}`,
            },
          ],
          isError: true,
        };
      }
    }
  
  private async handleSearchDatabase(args: {
      url: string;
      searchPattern: string;
      method?: 'GET' | 'POST';
      data?: string;
    }) {
      try {
        let command = `sqlmap -u "${args.url}"`;
  
        if (args.method === 'POST') {
          command += ` --method POST`;
          if (args.data) {
            command += ` --data "${args.data}"`;
          }
        }
  
        command += ` --search -C "${args.searchPattern}" --batch --random-agent`;
  
        const { stdout, stderr } = await execAsync(command);
        
        return {
          content: [
            {
              type: 'text',
              text: stdout + (stderr ? `\nErrors:\n${stderr}` : ''),
            },
          ],
        };
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: 'text',
              text: `执行sqlmap时出错: ${errorMessage}`,
            },
          ],
          isError: true,
        };
      }
    }
  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Sqlmap MCP server running on stdio');
  }
}

const server = new SqlmapServer();
server.run().catch(console.error);
