/**
 * This script extracts comments from MySQL and adds them to the Prisma schema
 * Fixed issues with duplicate comments and incomplete model definitions
 * Changed comment format to block comments and placed them on the line above the respective definition
 */

import { getDMMF } from '@prisma/sdk'
import * as mysql from 'mysql2/promise'
import * as fs from 'fs'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config()

async function syncMySQLComments() {
  // 1. Parse current Prisma Schema
  const schemaPath = path.resolve(__dirname, '../prisma/schema.prisma')
  const originalSchema = fs.readFileSync(schemaPath, 'utf8')

  // First clean existing comments in schema to avoid duplication
  // Clean line comments
  let cleanSchema = originalSchema.replace(/\s*\/\/\/\s*@comment\s*.*$/gm, '')
  // Clean block comments
  cleanSchema = cleanSchema.replace(/\s*\/\*\s*@comment\s*.*\*\/\s*$/gm, '')

  try {
    // 2. Connect to MySQL and get comment information
    const connection = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME
    })

    // Get table comments
    const [tableCommentsResult] = await connection.query(`
      SELECT TABLE_NAME, TABLE_COMMENT
      FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_COMMENT != ''
    `)
    const tableComments = tableCommentsResult as any[]

    // Get column comments
    const [columnCommentsResult] = await connection.query(`
      SELECT TABLE_NAME, COLUMN_NAME, COLUMN_COMMENT
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
      AND COLUMN_COMMENT != ''
    `)
    const columnComments = columnCommentsResult as any[]

    // Create mappings for faster lookup
    const tableCommentsMap = new Map()
    tableComments.forEach((t) => tableCommentsMap.set(t.TABLE_NAME, t.TABLE_COMMENT))

    const columnCommentsMap = new Map()
    columnComments.forEach((c) => {
      const key = `${c.TABLE_NAME}.${c.COLUMN_NAME}`
      columnCommentsMap.set(key, c.COLUMN_COMMENT)
    })

    // 3. Process model and field comments
    const lines = cleanSchema.split('\n')
    const resultLines: string[] = []

    let currentModel: string | null = null
    let currentTable: string | null = null
    let inModelBlock = false
    let modelStartLine = -1

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trimEnd() // Only remove trailing whitespace, preserve indentation
      const trimmedLine = line.trim()
      const indentation = line.match(/^\s*/)?.[0] || '' // Get current line indentation, use optional chaining to avoid null value

      // Detect model definition start
      const modelMatch = trimmedLine.match(/^model\s+(\w+)\s+{/)
      if (modelMatch) {
        currentModel = modelMatch[1]
        inModelBlock = true
        modelStartLine = i
        currentTable = currentModel // Default to use model name as table name

        // Find the end of the model definition block
        let modelEndLine = i
        for (let j = i + 1; j < lines.length; j++) {
          if (lines[j].trim() === '}') {
            modelEndLine = j
            break
          }
        }

        // Find @@map attribute within the model definition block
        for (let j = i + 1; j <= modelEndLine; j++) {
          const mapMatch = lines[j].trim().match(/^@@map\s*\(\s*["']([^"']+)["']\s*\)/)
          if (mapMatch) {
            currentTable = mapMatch[1]
            break
          }
        }

        // If there's a table comment, add it before the model definition
        const tableComment = tableCommentsMap.get(currentTable)
        if (tableComment) {
          resultLines.push(`${indentation}/* @comment ${tableComment} */`)
        }

        resultLines.push(line)
        continue
      }

      // Detect model definition end
      if (inModelBlock && trimmedLine === '}') {
        inModelBlock = false
        currentModel = null
        currentTable = null
        resultLines.push(line)
        continue
      }

      // Process fields
      if (inModelBlock && currentModel && currentTable) {
        // Match field definition (excluding comment lines and empty lines)
        const fieldMatch = trimmedLine.match(/^(\w+)\s+.+/)
        if (
          fieldMatch &&
          !trimmedLine.startsWith('//') &&
          !trimmedLine.startsWith('/*') &&
          trimmedLine !== ''
        ) {
          const fieldName = fieldMatch[1]

          // Find the corresponding database column name - Find @@map attribute within the line
          const dbNameMatch = trimmedLine.match(/@map\s*\(\s*["']([^"']+)["']\s*\)/)
          const dbColumn = dbNameMatch ? dbNameMatch[1] : fieldName

          // Find column comment
          const columnKey = `${currentTable}.${dbColumn}`
          const columnComment = columnCommentsMap.get(columnKey)

          if (columnComment) {
            // Add comment before field definition, preserving appropriate indentation
            resultLines.push(`${indentation}/* @comment ${columnComment} */`)
          }
        }

        resultLines.push(line)
      } else {
        // Non-field lines, add directly
        resultLines.push(line)
      }
    }

    // 4. Save enhanced schema
    const enhancedSchema = resultLines.join('\n')
    fs.writeFileSync(path.resolve(__dirname, '../prisma/enhanced-schema.prisma'), enhancedSchema)
    console.log('MySQL comment-enhanced version has been saved to prisma/enhanced-schema.prisma')

    await connection.end()
  } catch (error) {
    console.error('Error processing schema:', error)
    throw error
  }
}

// Execute synchronization
syncMySQLComments().catch(console.error)