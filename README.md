# Prisma MySQL Toolkit

A collection of utility scripts for working with Prisma and MySQL databases.

## Features

- Convert MySQL table and column names to Prisma naming conventions (Pascal case for models, camel case for fields)
- Pull MySQL table and column comments into your Prisma schema
- Push comments from Prisma schema back to MySQL database
- Support for handling singular/plural table name conversion

## Scripts

### `dbMap.ts`

Converts MySQL naming conventions to Prisma naming standards:

- Transforms table names to PascalCase and adds `@map` directives
- Converts plural table names to singular form
- Transforms column names to camelCase and adds `@map` directives
- Handles field names in Prisma directives (@@index, @@unique, etc.)

### `dbCommentPull.ts`

Extracts comments from MySQL database tables and columns and adds them to your Prisma schema:

- Pulls table and column comments from MySQL
- Adds them as block comments (`/* @comment ... */`) above the corresponding definitions
- Avoids duplicate comments

### `dbCommentPush.ts`

Syncs comments from your Prisma schema back to MySQL:

- Reads the `@comment` annotations in your schema
- Updates the corresponding table and column comments in MySQL

## Important Note

**⚠️ These synchronization tools currently only work with MySQL databases.**

Support for other database engines may be added in the future.

## Usage

1. Install dependencies:
   ```
   npm install
   ```

2. Configure your database connection in `.env`:
   ```
   DB_HOST=localhost
   DB_USER=root
   DB_PASSWORD=your_password
   DB_NAME=your_database
   ```

3. Run the desired script:

   Using Node.js:
   ```
   # Convert naming conventions
   npx ts-node dbMap.ts
   
   # Pull comments from MySQL to Prisma
   npx ts-node dbCommentPull.ts
   
   # Push comments from Prisma to MySQL
   npx ts-node dbCommentPush.ts
   ```

   Using Bun:
   ```
   # Convert naming conventions
   bun run dbMap.ts
   
   # Pull comments from MySQL to Prisma
   bun run dbCommentPull.ts
   
   # Push comments from Prisma to MySQL
   bun run dbCommentPush.ts
   ```
