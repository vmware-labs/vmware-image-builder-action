module.exports = {
  clearMocks: true,
  moduleFileExtensions: ['js', 'ts'],
  moduleNameMapper: {
    "axios": "axios/dist/node/axios.cjs"
  },
  roots: ['<rootDir>'],
  testEnvironment: 'node',
  testMatch: ['**/*.test.ts'],
  testRunner: 'jest-circus/runner',
  testTimeout: 15000,
  transform: {
    '^.+\\.ts$': 'ts-jest'
  },
  verbose: true
}