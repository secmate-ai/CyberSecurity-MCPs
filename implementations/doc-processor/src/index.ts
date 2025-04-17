#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
  CallToolRequest,
} from '@modelcontextprotocol/sdk/types.js';
import { 
  Document, 
  Paragraph, 
  TextRun, 
  HeadingLevel, 
  convertInchesToTwip, 
  LineRuleType,
  ISectionOptions,
  Table,
  TableRow,
  TableCell,
  BorderStyle,
  WidthType,
  AlignmentType,
  HorizontalPositionAlign,
  Packer
} from 'docx';
import { Tokens, marked } from 'marked';
import * as fs from 'fs/promises';
import * as path from 'path';

interface MarkedToken extends Tokens.Generic {
  tokens?: MarkedToken[];
  depth?: number;
  ordered?: boolean;
  start?: number;
  items?: Array<Tokens.ListItem & { task?: boolean; checked?: boolean; tokens?: MarkedToken[] }>;
  header?: Array<{ text: string }>;
  rows?: Array<Array<{ text: string }>>;
  loose?: boolean;
  parentItem?: number;
}

type HeadingLevelType = typeof HeadingLevel[keyof typeof HeadingLevel];

interface DocStyles {
  normal: {
    font: string;
    size: number;
  };
  h1: {
    font: string;
    size: number;
  };
  h2: {
    font: string;
    size: number;
  };
  h3: {
    font: string;
    size: number;
    bold: boolean;
  };
}

interface MarkdownToWordArgs {
  markdownPath: string;
  outputPath: string;
}

interface WriteMarkdownToWordArgs {
  content: string;
  outputPath: string;
}

const STYLES: DocStyles = {
  normal: {
    font: '仿宋_GB2312',
    size: 32, // 三号
  },
  h1: {
    font: '小标宋体',
    size: 36, // 二号
  },
  h2: {
    font: '楷体_GB2312',
    size: 32, // 三号
  },
  h3: {
    font: '仿宋_GB2312',
    size: 32, // 三号
    bold: true,
  },
};

class DocProcessorServer {
  private server: Server;

  constructor() {
    this.server = new Server(
      {
        name: 'doc-processor',
        version: '1.0.0',
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
          name: 'markdown_to_word',
          description: '将Markdown文件转换为Word文档',
          inputSchema: {
            type: 'object',
            properties: {
              markdownPath: {
                type: 'string',
                description: 'Markdown文件路径',
              },
              outputPath: {
                type: 'string',
                description: 'Word文档输出路径',
              },
            },
            required: ['markdownPath', 'outputPath'],
          },
        },
        {
          name: 'write_markdown_to_word',
          description: '将Markdown文本内容写入Word文档',
          inputSchema: {
            type: 'object',
            properties: {
              content: {
                type: 'string',
                description: 'Markdown格式的文本内容',
              },
              outputPath: {
                type: 'string',
                description: 'Word文档输出路径',
              },
            },
            required: ['content', 'outputPath'],
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request: CallToolRequest) => {
      try {
        switch (request.params.name) {
          case 'markdown_to_word': {
            const args = request.params.arguments as unknown as MarkdownToWordArgs;
            return await this.handleMarkdownToWord(args);
          }
          case 'write_markdown_to_word': {
            const args = request.params.arguments as unknown as WriteMarkdownToWordArgs;
            return await this.handleWriteMarkdownToWord(args);
          }
          default:
            throw new McpError(
              ErrorCode.MethodNotFound,
              `未知工具: ${request.params.name}`
            );
        }
      } catch (error: unknown) {
        if (error instanceof McpError) {
          throw error;
        }
        throw new McpError(
          ErrorCode.InternalError,
          `处理文档时发生错误: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    });
  }

  private async handleMarkdownToWord(args: MarkdownToWordArgs) {
    if (!args.markdownPath || !args.outputPath) {
      throw new McpError(ErrorCode.InvalidParams, '缺少必要的参数');
    }

    try {
      const markdownContent = await fs.readFile(args.markdownPath, 'utf-8');
      const doc = await this.createWordDoc(markdownContent);
      await this.saveWordDocument(doc, args.outputPath);

      return {
        content: [
          {
            type: 'text',
            text: `成功将Markdown文件转换为Word文档: ${args.outputPath}`,
          },
        ],
      };
    } catch (error: unknown) {
      throw new McpError(
        ErrorCode.InternalError,
        `处理文件失败: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private async handleWriteMarkdownToWord(args: WriteMarkdownToWordArgs) {
    if (!args.content || !args.outputPath) {
      throw new McpError(ErrorCode.InvalidParams, '缺少必要的参数');
    }

    try {
      const doc = await this.createWordDoc(args.content);
      await this.saveWordDocument(doc, args.outputPath);

      return {
        content: [
          {
            type: 'text',
            text: `成功创建Word文档: ${args.outputPath}`,
          },
        ],
      };
    } catch (error: unknown) {
      throw new McpError(
        ErrorCode.InternalError,
        `创建文档失败: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private createTableFromMarkdown(header: string[], rows: string[][]): Table {
    return new Table({
      width: {
        size: 100,
        type: WidthType.PERCENTAGE,
      },
      borders: {
        top: { style: BorderStyle.SINGLE, size: 1, color: '000000' },
        bottom: { style: BorderStyle.SINGLE, size: 1, color: '000000' },
        left: { style: BorderStyle.SINGLE, size: 1, color: '000000' },
        right: { style: BorderStyle.SINGLE, size: 1, color: '000000' },
        insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: '000000' },
        insideVertical: { style: BorderStyle.SINGLE, size: 1, color: '000000' },
      },
      rows: [
        new TableRow({
          children: header.map(cell => new TableCell({
            children: [new Paragraph({
              children: [new TextRun({
                text: cell,
                font: STYLES.normal.font,
                size: STYLES.normal.size,
                color: '000000',
                bold: true,
              })],
              alignment: AlignmentType.CENTER,
            })],
            verticalAlign: 'center',
          })),
        }),
        ...rows.map(row => new TableRow({
          children: row.map(cell => new TableCell({
            children: [new Paragraph({
              children: [new TextRun({
                text: cell,
                font: STYLES.normal.font,
                size: STYLES.normal.size,
                color: '000000',
              })],
            })],
          })),
        })),
      ],
    });
  }

  private createListItemParagraph(text: string, level: number = 0, ordered: boolean = false, index?: number): Paragraph {
    // 创建列表项标记，根据类型和层级使用不同符号或数字
    const bullet = ordered ? `${index}. ` : '• ';
    const runs = this.parseInlineContent(text.trim());
    
    return new Paragraph({
      children: [
        new TextRun({
          text: bullet,
          font: STYLES.normal.font,
          size: STYLES.normal.size,
          color: '000000',
          bold: ordered, // 有序列表项编号使用粗体
        }),
        ...runs
      ],
      indent: {
        // 根据嵌套级别调整缩进
        left: convertInchesToTwip(0.3 * (level + 1)),
        // 调整悬挂缩进，确保项目符号/数字与文本对齐
        hanging: ordered ? convertInchesToTwip(0.3) : convertInchesToTwip(0.2),
      },
      spacing: {
        line: 360,
        lineRule: LineRuleType.EXACT,
        // 调整列表项间距，嵌套列表项间距更小
        before: level > 0 ? convertInchesToTwip(0.02) : convertInchesToTwip(0.05),
        after: level > 0 ? convertInchesToTwip(0.02) : convertInchesToTwip(0.05),
      },
    });
  }

  private extractNestedListStructure(markdownContent: string): MarkedToken[] {
    // 使用marked解析器解析原始Markdown内容
    return marked.lexer(markdownContent) as MarkedToken[];
  }

  private processNestedList(children: (Paragraph | Table)[], listToken: MarkedToken, level: number = 0, parentBullet: string = ''): void {
    const ordered = listToken.ordered || false;
    let index = listToken.start !== undefined ? listToken.start : 1;
    
    // 对于嵌套列表处理的特殊规则
    const useNestedBullets = level > 0;

    for (const item of listToken.items!) {
      const itemText = (item as Tokens.ListItem).text || '';
      
      if (itemText.trim()) {
        // 处理当前列表项
        let displayText = itemText;
        
        // 对于嵌套列表，如果是用户示例中的格式，不重复显示序号
        if (useNestedBullets && parentBullet && displayText.startsWith(parentBullet)) {
          displayText = displayText.substring(parentBullet.length).trim();
        }
        
        // 创建列表项的段落
        const paragraph = this.createListItemParagraph(
          displayText,
          level,
          ordered,
          ordered ? index : undefined
        );
        children.push(paragraph);
      }
      
      // 记录当前项目的编号（用于处理子列表）
      const currentBullet = ordered ? `${index}. ` : '';
      
      // 递增有序列表的索引
      if (ordered) index++;
      
      // 处理嵌套列表
      const itemTokens = (item as any).tokens;
      if (itemTokens) {
        for (const subToken of itemTokens) {
          if (subToken.type === 'list') {
            this.processNestedList(children, subToken as MarkedToken, level + 1, currentBullet);
          }
        }
      }
    }
  }

  private createBlockquoteParagraph(text: string): Paragraph {
    return new Paragraph({
      children: [
        new TextRun({
          text: text,
          font: STYLES.normal.font,
          size: STYLES.normal.size,
          color: '000000',
          italics: true,
        }),
      ],
      indent: {
        left: convertInchesToTwip(0.5),
        right: convertInchesToTwip(0.5),
      },
      spacing: {
        line: 360,
        before: convertInchesToTwip(0.1),
        after: convertInchesToTwip(0.1),
      },
      border: {
        left: {
          style: BorderStyle.SINGLE,
          size: 3,
          color: '808080',
        },
      },
    });
  }

  private parseInlineContent(content: string): TextRun[] {
    const runs: TextRun[] = [];
    let currentText = '';
    let isStrong = false;
    let isEm = false;
    let isDel = false;
    let isCode = false;

    const addCurrentText = () => {
      if (currentText) {
        runs.push(new TextRun({
          text: currentText,
          font: isCode ? 'Courier New' : STYLES.normal.font,
          size: isCode ? 24 : STYLES.normal.size,
          color: '000000',
          bold: isStrong,
          italics: isEm,
          strike: isDel,
        }));
        currentText = '';
      }
    };

    let i = 0;
    while (i < content.length) {
      // 处理反引号代码
      if (content[i] === '`') {
        addCurrentText();
        isCode = !isCode;
        i++;
        continue;
      }

      // 处理加粗斜体
      if (content.slice(i, i + 3) === '***') {
        addCurrentText();
        isStrong = !isStrong;
        isEm = !isEm;
        i += 3;
        continue;
      }

      // 处理加粗
      if (content.slice(i, i + 2) === '**') {
        addCurrentText();
        isStrong = !isStrong;
        i += 2;
        continue;
      }

      // 处理删除线
      if (content.slice(i, i + 2) === '~~') {
        addCurrentText();
        isDel = !isDel;
        i += 2;
        continue;
      }

      // 处理斜体
      if (content[i] === '*' && content[i + 1] !== '*') {
        addCurrentText();
        isEm = !isEm;
        i++;
        continue;
      }

      currentText += content[i];
      i++;
    }

    addCurrentText();
    return runs;
  }

  private preprocessMarkdown(markdown: string): string {
    // 按行分割Markdown内容
    const lines = markdown.split('\n');
    const resultLines: string[] = [];
    
    // 跟踪当前处理的列表项
    let currentMainListItem: number | null = null;
    let processingNestedList = false;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmedLine = line.trim();
      
      // 检测主列表项（数字+点+空格开头）
      const mainListMatch = trimmedLine.match(/^(\d+)\.\s+\*\*(.+)\*\*$/);
      
      // 匹配用户示例中的特定格式 "- 使用..."
      const nestedDashMatch = trimmedLine.match(/^-\s+(.+)$/);
      
      if (mainListMatch) {
        // 找到主列表项（数字+粗体文本）
        currentMainListItem = parseInt(mainListMatch[1]);
        processingNestedList = false;
        resultLines.push(line);
      } else if (nestedDashMatch && currentMainListItem !== null) {
        // 检测到嵌套列表项，格式转换为标准Markdown嵌套列表
        if (!processingNestedList) {
          processingNestedList = true;
        }
        
        // 添加额外缩进，确保marked识别为嵌套列表
        resultLines.push(`   - ${nestedDashMatch[1]}`);
      } else {
        // 非列表行或未识别的格式
        if (trimmedLine === '') {
          processingNestedList = false;
        }
        resultLines.push(line);
      }
    }
    
    return resultLines.join('\n');
  }

  private async createWordDoc(markdownContent: string): Promise<Document> {
    // 预处理Markdown，确保嵌套列表格式正确
    const processedMarkdown = this.preprocessMarkdown(markdownContent);
    
    // 配置marked解析器，确保正确处理嵌套列表
    marked.use({
      gfm: true,
      breaks: true,
    });
    
    const tokens = marked.lexer(processedMarkdown) as MarkedToken[];
    const children: (Paragraph | Table)[] = [];

    for (const token of tokens) {
      switch (token.type) {
        case 'heading':
          const headingToken = token as Tokens.Heading;
          const headingLevel = headingToken.depth;
          const style = this.getHeadingStyle(headingLevel);
          
          if (headingLevel === 1) {
            children.push(
              new Paragraph({
                spacing: { before: convertInchesToTwip(0.3) },
              })
            );
          } else if (headingLevel === 2) {
            children.push(
              new Paragraph({
                spacing: { 
                  before: convertInchesToTwip(0.15),
                  after: convertInchesToTwip(0.15),
                },
              })
            );
          }

          const headingMap: { [key: number]: HeadingLevelType } = {
            1: HeadingLevel.HEADING_1,
            2: HeadingLevel.HEADING_2,
            3: HeadingLevel.HEADING_3,
            4: HeadingLevel.HEADING_4,
            5: HeadingLevel.HEADING_5,
            6: HeadingLevel.HEADING_6,
          };

          children.push(
            new Paragraph({
              heading: headingMap[headingToken.depth] || HeadingLevel.HEADING_1,
              spacing: {
                before: headingLevel === 1 ? convertInchesToTwip(0.5) : 0,
                after: headingLevel === 1 ? convertInchesToTwip(0.3) : 0,
              },
              children: [
                new TextRun({
                  text: headingToken.text,
                  font: style.font,
                  size: style.size,
                  color: '000000',
                  ...(style.hasOwnProperty('bold') && { bold: (style as DocStyles['h3']).bold }),
                })
              ]
            })
          );
          break;

        case 'paragraph':
          const paragraphToken = token as Tokens.Paragraph;
          const runs = this.parseInlineContent(paragraphToken.text);

          children.push(
            new Paragraph({
              children: runs,
              spacing: {
                line: 560,
                lineRule: LineRuleType.EXACT,
              },
              alignment: 'both',
              indent: {
                firstLine: convertInchesToTwip(0.29),
              },
            })
          );
          break;

        case 'code':
          const codeToken = token as Tokens.Code;
          const codeLines = codeToken.text.split('\n');
          const codeRuns = codeLines.map((line, index) => [
            new TextRun({
              text: line,
              font: 'Courier New',
              size: 24,
              color: '000000',
            }),
            ...(index < codeLines.length - 1 ? [new TextRun({ break: 1 })] : [])
          ]).flat();

          children.push(
            new Paragraph({
              children: codeRuns,
              spacing: {
                before: convertInchesToTwip(0.2),
                after: convertInchesToTwip(0.2),
              },
              alignment: 'left',
              indent: {
                left: convertInchesToTwip(0.5),
              },
            })
          );
          break;

        case 'table':
          const tableToken = token as MarkedToken;
          const header = tableToken.header!.map((cell: { text: string }) => cell.text);
          const rows = tableToken.rows!.map((row: Array<{ text: string }>) => 
            row.map(cell => cell.text)
          );
          children.push(this.createTableFromMarkdown(header, rows));
          break;

        case 'list':
          const listToken = token as MarkedToken;
          this.processNestedList(children, listToken);
          break;

        case 'blockquote':
          const blockquoteToken = token as MarkedToken;
          if (blockquoteToken.tokens) {
            for (const quote of blockquoteToken.tokens) {
              if (quote.type === 'paragraph') {
                children.push(this.createBlockquoteParagraph((quote as Tokens.Paragraph).text));
              }
            }
          }
          break;

        case 'hr':
          children.push(
            new Paragraph({
              children: [new TextRun({ text: '─'.repeat(50), color: '000000' })],
              alignment: AlignmentType.CENTER,
              spacing: {
                before: convertInchesToTwip(0.2),
                after: convertInchesToTwip(0.2),
              },
            })
          );
          break;
      }
    }

    const sections: ISectionOptions[] = [{
      properties: {},
      children: children,
    }];

    return new Document({
      sections: sections,
    });
  }

  private getHeadingStyle(level: number): DocStyles[keyof DocStyles] {
    switch (level) {
      case 1:
        return STYLES.h1;
      case 2:
        return STYLES.h2;
      case 3:
        return STYLES.h3;
      default:
        return STYLES.normal;
    }
  }

  private async saveWordDocument(doc: Document, outputPath: string) {
    const buffer = await Packer.toBuffer(doc);
    const dir = path.dirname(outputPath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(outputPath, buffer);
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('文档处理 MCP 服务器运行中...');
  }
}

const server = new DocProcessorServer();
server.run().catch(console.error);