/**
 * This script converts MySQL table and field names to Prisma naming conventions
 * 1. Table names will be converted to PascalCase with @map mapping
 * 2. Table names will be converted from plural to singular form
 * 3. Field names will be converted to camelCase with @map mapping
 * 4. Field names in indexes and other directives will also be converted to camelCase
 * 5. Supports processing index fields with sort parameters, such as field_name(sort: Desc)
 */

import * as mysql from 'mysql2/promise'
import * as fs from 'fs'
import dotenv from 'dotenv'
import path from 'path'
import { pascalCase, camelCase } from 'change-case'
import { singular } from 'pluralize'

dotenv.config()

// 检查字符串是否需要转换 (全小写或蛇形命名)
function shouldTransform(str: string) {
  return str === str.toLowerCase()
}

// 转换表名：转为单数形式，然后转为大驼峰
function transformTableName(tableName: string) {
  // 先转为单数形式
  const singularName = singular(tableName)
  // 再转为大驼峰(PascalCase)
  return pascalCase(singularName)
}

// 转换Prisma指令中的字段名（如@@index, @@unique等）
function transformDirectiveFields(
  line: string,
  columnMap: Map<string, string>,
  currentTable: string
) {
  // 匹配所有包含字段列表的指令
  const directiveMatch = line.match(/@@(?:index|unique|id|fulltext)\s*\(\s*\[(.*?)\]/)
  if (!directiveMatch) return line

  const fieldsStr = directiveMatch[1]

  // 创建一个处理后的字段字符串
  let transformedFieldsStr = fieldsStr

  // 匹配字段，包括可能带有参数的字段 field_name 或 field_name(params)
  const fieldPattern = /(\w+)(\([^)]*\))?/g
  let fieldMatch

  // 使用正则表达式全局搜索模式来替换所有匹配的字段
  while ((fieldMatch = fieldPattern.exec(fieldsStr)) !== null) {
    const fullMatch = fieldMatch[0] // 完整匹配，如 "field_name" 或 "field_name(sort: Desc)"
    const fieldName = fieldMatch[1] // 仅字段名，如 "field_name"
    const fieldParams = fieldMatch[2] || '' // 参数部分（如果有），如 "(sort: Desc)"

    if (shouldTransform(fieldName)) {
      const columnKey = `${currentTable}.${fieldName}`
      const camelFieldName = columnMap.get(columnKey) || camelCase(fieldName)

      // 替换字段名但保留参数
      const replacement = camelFieldName + fieldParams

      // 在整个字段字符串中替换这个特定的字段
      transformedFieldsStr = transformedFieldsStr.replace(fullMatch, replacement)
    }
  }

  // 替换原始字段字符串
  return line.replace(
    new RegExp(`\\[${fieldsStr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]`),
    `[${transformedFieldsStr}]`
  )
}

async function convertToCamelAndPascal() {
  // 1. 解析当前 Prisma Schema
  const schemaPath = path.resolve(__dirname, '../prisma/schema.prisma')
  const originalSchema = fs.readFileSync(schemaPath, 'utf8')

  try {
    // 2. 连接 MySQL 获取表和列信息
    const connection = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME
    })

    // 获取所有表名
    const [tablesResult] = await connection.query(`
      SELECT TABLE_NAME
      FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
    `)
    const tables = tablesResult as any[]

    // 获取所有列名
    const [columnsResult] = await connection.query(`
      SELECT TABLE_NAME, COLUMN_NAME
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
    `)
    const columns = columnsResult as any[]

    // 创建表名映射
    const tableMap = new Map()
    tables.forEach((t) => {
      if (shouldTransform(t.TABLE_NAME)) {
        tableMap.set(t.TABLE_NAME, transformTableName(t.TABLE_NAME))
      }
    })

    // 创建列名映射
    const columnMap = new Map()
    columns.forEach((c) => {
      if (shouldTransform(c.COLUMN_NAME)) {
        const key = `${c.TABLE_NAME}.${c.COLUMN_NAME}`
        columnMap.set(key, camelCase(c.COLUMN_NAME))
      }
    })

    // 3. 转换Schema文件
    const enhancedLines: string[] = []
    const lines = originalSchema.split('\n')

    let currentModel: string | null = null
    let currentTable: string | null = null
    let inModelBlock = false
    let tableHasMap = false

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trimEnd() // 只移除末尾空白，保留缩进
      const trimmedLine = line.trim()
      let enhancedLine = line

      // 检测模型定义开始
      const modelMatch = trimmedLine.match(/^model\s+(\w+)\s+{/)
      if (modelMatch) {
        currentModel = modelMatch[1]
        inModelBlock = true
        tableHasMap = false

        // 检查是否已有@map注解
        for (let j = i + 1; j < lines.length && !lines[j].trim().startsWith('}'); j++) {
          if (lines[j].includes('@@map(')) {
            tableHasMap = true
            // 提取当前表名
            const dbNameMatch = lines[j].match(/@map\s*\(\s*["']([^"']+)["']\s*\)/)
            if (dbNameMatch) {
              currentTable = dbNameMatch[1]
            }
            break
          }
        }

        // 如果没有@map
        if (!tableHasMap) {
          // 尝试查找对应的表
          let foundMatchingTable = false

          for (const [tableName, transformedName] of tableMap.entries()) {
            if (transformedName === currentModel) {
              currentTable = tableName
              enhancedLine = `model ${transformedName} {`
              foundMatchingTable = true
              break
            } else if (
              currentModel && // 确保currentModel不是null
              (tableName === currentModel.toLowerCase() ||
                transformTableName(tableName) === currentModel)
            ) {
              // 如果模型名与表名相似但大小写不同，或者表的转换后名称与模型名匹配
              currentTable = tableName
              enhancedLine = `model ${transformTableName(tableName)} {`
              foundMatchingTable = true
              break
            }
          }

          // 如果没找到匹配的，假设当前模型名就是表名（小写形式）
          if (!foundMatchingTable && currentModel) {
            currentTable = currentModel.toLowerCase()
          }
        }

        enhancedLines.push(enhancedLine)

        // 如果需要添加@map注解 - 确保对任何表名都添加@@map，如果转换前后不同
        if (!tableHasMap && currentTable) {
          const transformedTableName = transformTableName(currentTable)
          if (transformedTableName !== currentTable) {
            enhancedLines.push(`  @@map("${currentTable}")`)
          }
        }

        continue
      }

      // 检测模型定义结束
      if (inModelBlock && trimmedLine === '}') {
        inModelBlock = false
        currentModel = null
        currentTable = null
        enhancedLines.push(enhancedLine)
        continue
      }

      // 处理Prisma指令中的字段名
      if (inModelBlock && currentTable && trimmedLine.match(/^@@(index|unique|id|fulltext)/)) {
        enhancedLine = transformDirectiveFields(line, columnMap, currentTable)
        enhancedLines.push(enhancedLine)
        continue
      }

      // 处理字段
      if (inModelBlock && currentModel && currentTable) {
        // 匹配字段定义（排除注释行和空行）
        const fieldMatch = trimmedLine.match(/^(\w+)\s+(.+)/)
        if (fieldMatch && !trimmedLine.startsWith('//') && trimmedLine !== '') {
          const fieldName = fieldMatch[1]
          const fieldRest = fieldMatch[2]

          // 检查是否已有@map注解
          const hasMap = fieldRest.includes('@map(')

          if (!hasMap && shouldTransform(fieldName)) {
            const camelFieldName = camelCase(fieldName)
            if (camelFieldName !== fieldName) {
              const columnKey = `${currentTable}.${fieldName}`
              const mappedFieldName = columnMap.get(columnKey) || camelFieldName

              // 替换字段名为小驼峰并添加@map
              enhancedLine = line.replace(
                new RegExp(`^(\\s*)${fieldName}\\s+`),
                `$1${mappedFieldName} `
              )

              // 在行末添加@map
              enhancedLine += ` @map("${fieldName}")`
            }
          }
        }
      }

      enhancedLines.push(enhancedLine)
    }

    // 4. 保存转换后的 schema
    const enhancedSchema = enhancedLines.join('\n')
    fs.writeFileSync(
      path.resolve(__dirname, '../prisma/enhanced-schema-singular.prisma'),
      enhancedSchema
    )
    console.log('转换后的版本已经保存到 prisma/enhanced-schema-singular.prisma')

    await connection.end()
  } catch (error) {
    console.error('处理 schema 时出错:', error)
    throw error
  }
}

// 执行转换
convertToCamelAndPascal().catch(console.error)