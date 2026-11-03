/** Testes unitários do modelo de dados (src/viewModel.ts). */
module.exports = {
    testEnvironment: "node",
    roots: ["<rootDir>/test"],
    transform: {
        "^.+\\.ts$": ["ts-jest", { tsconfig: "tsconfig.test.json" }]
    }
};
