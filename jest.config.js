/** Tests live in test/ rather than beside the code: the scene tsconfig locks `types`
 *  to @dcl/js-runtime and `sdk-commands build` type-checks all of src/, so a spec
 *  there would fail the build on Jest's globals. tsconfig.test.json adds them. */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/test/**/*.spec.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.test.json' }]
  }
}
