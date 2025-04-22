/**
 * This script synchronizes comments from Prisma Schema to MySQL database
 * It performs the reverse operation of the original MySQL to Prisma synchronization script
 */

import * as mysql from 'mysql2/promise'
import * as fs from 'fs'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config()

interface FieldInfo {
  fieldName: string
  dbColumn: string
  comment: string
}

interface ModelInfo {
  modelName: string
  tableName: string
  comment: string | null
  fields: FieldInfo[]
}

interface ColumnDefinition {
  Field: string
  Type: string
  Null: string
  Key: string
  Default: string | null
  Extra: string
}

async function syncPrismaCommentsToMySQL() {
  console.log('Starting to synchronize comments from Prisma Schema to MySQL...')

  // 1. Read Prisma Schema file
  const schemaPath = path.resolve(__dirname, '../prisma/schema.prisma')
  const schema = fs.readFileSync(schemaPath, 'utf8')

  // 2. Parse models and comments from Schema
  const models = parsePrismaSchema(schema)
  console.log(`Successfully parsed ${models.length} models`)

  try {
    // 3. Connect to MySQL database
    const connection = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME
    })

    console.log('Successfully connected to MySQL database')

    // 4. Synchronize comments to MySQL
    let tablesUpdated = 0
    let columnsUpdated = 0

    for (const model of models) {
      // 4.1 Update table comments
      if (model.comment) {
        await connection.query(`ALTER TABLE \`${model.tableName}\` COMMENT = ?`, [model.comment])
        tablesUpdated++
        console.log(`Updated table comment: ${model.tableName}`)
      }

      // 4.2 Update column comments
      for (const field of model.fields) {
        if (field.comment) {
          // Get current column definition
          const [columns] = (await connection.query(
            `SHOW COLUMNS FROM \`${model.tableName}\` LIKE ?`,
            [field.dbColumn]
          )) as [ColumnDefinition[], any]

          if (columns.length > 0) {
            const column = columns[0]

            // Build MODIFY COLUMN statement
            let nullStatement = column.Null === 'YES' ? 'NULL' : 'NOT NULL'
            let defaultStatement =
              column.Default === null ? '' : ` DEFAULT ${mysql.escape(column.Default)}`
            let extraStatement = column.Extra ? ` ${column.Extra}` : ''

            await connection.query(
              `ALTER TABLE \`${model.tableName}\` MODIFY COLUMN \`${field.dbColumn}\` ${column.Type} ${nullStatement}${defaultStatement}${extraStatement} COMMENT ?`,
              [field.comment]
            )

            columnsUpdated++
            console.log(`Updated column comment: ${model.tableName}.${field.dbColumn}`)
          } else {
            console.warn(`Warning: Column not found ${model.tableName}.${field.dbColumn}`)
          }
        }
      }
    }

    console.log(`Comment synchronization completed! Updated ${tablesUpdated} table comments and ${columnsUpdated} column comments`)
    await connection.end()
  } catch (error) {
    console.error('Error during comment synchronization:', error)
    throw error
  }
}

function parsePrismaSchema(schema: string): ModelInfo[] {
  const models: ModelInfo[] = []
  const lines = schema.split('\n')

  let currentModel: ModelInfo | null = null
  let inModelBlock = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()

    // Detect model definition start
    const modelMatch = line.match(/^model\s+(\w+)\s+{/)
    if (modelMatch) {
      currentModel = {
        modelName: modelMatch[1],
        tableName: modelMatch[1], // Default to using model name as table name
        comment: null,
        fields: []
      }
      inModelBlock = true

      // Check table mapping
      for (let j = i + 1; j < lines.length; j++) {
        const mapLine = lines[j].trim()
        const mapMatch = mapLine.match(/@map\s*\(\s*["']([^"']+)["']\s*\)/)
        if (mapMatch) {
          currentModel.tableName = mapMatch[1]
          break
        }
        // If encountering field definition or block end, stop searching for mapping
        if (mapLine === '}' || mapLine.match(/^\w+\s/)) break
      }

      // Check table comment
      for (let j = i + 1; j < i + 5; j++) {
        // Only check the next few lines
        if (j >= lines.length) break
        const commentLine = lines[j].trim()
        const commentMatch = commentLine.match(/\/\/\/\s*@comment\s+(.+)$/)
        if (commentMatch) {
          currentModel.comment = commentMatch[1]
          break
        }
        // If encountering field definition, stop searching for comment
        if (commentLine.match(/^\w+\s/)) break
      }

      continue
    }

    // Detect model definition end
    if (inModelBlock && line === '}') {
      if (currentModel) {
        models.push(currentModel)
      }
      inModelBlock = false
      currentModel = null
      continue
    }

    // Process field and comment
    if (inModelBlock && currentModel) {
      // Match field definition (excluding comment lines and empty lines)
      const fieldMatch = line.match(/^(\w+)\s+.+/)
      if (fieldMatch && !line.startsWith('//') && line !== '') {
        const fieldName = fieldMatch[1]
        let dbColumn = fieldName // Default to using field name as column name
        let comment: string | null = null

        // Check column mapping
        const dbNameMatch = line.match(/@map\s*\(\s*["']([^"']+)["']\s*\)/)
        if (dbNameMatch) {
          dbColumn = dbNameMatch[1]
        }

        // Check inline comment
        const inlineCommentMatch = line.match(/\/\/\/\s*@comment\s+(.+)$/)
        if (inlineCommentMatch) {
          comment = inlineCommentMatch[1]
        } else {
          // Check if the next line has a comment
          if (i + 1 < lines.length) {
            const nextLine = lines[i + 1].trim()
            const nextLineCommentMatch = nextLine.match(/\/\/\/\s*@comment\s+(.+)$/)
            if (nextLineCommentMatch) {
              comment = nextLineCommentMatch[1]
            }
          }
        }

        if (comment) {
          currentModel.fields.push({
            fieldName,
            dbColumn,
            comment
          })
        }
      }
    }
  }

  return models
}

// Execute synchronization
syncPrismaCommentsToMySQL().catch(console.error)
