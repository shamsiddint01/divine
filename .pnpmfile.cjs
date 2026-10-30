// pnpm install hook'lari.
//
// Ba'zi runtime paketlar build-time vositalarni IXTIYORIY peer sifatida e'lon qiladi. pnpm ularni
// workspace'dagi devDependency'larga bog'lab qo'yadi va `pnpm deploy --prod` production image'ga
// Prisma CLI, Studio, pglite, TypeScript va React'ni (~250 MB) olib kiradi:
//   - @prisma/client → prisma (CLI), typescript: generated client runtime'da faqat
//     `@prisma/client/runtime/*` ni ishlatadi;
//   - @nestjs/swagger → typescript: faqat build-time CLI plagini uchun.
// Shu ixtiyoriy peer'lar olib tashlanadi. Runtime xatti-harakati o'zgarmaydi.
const DROP_OPTIONAL_PEERS = {
  '@prisma/client': ['prisma', 'typescript'],
  '@nestjs/swagger': ['typescript'],
};

function readPackage(pkg) {
  const drop = DROP_OPTIONAL_PEERS[pkg.name];
  if (drop && pkg.peerDependencies) {
    for (const name of drop) {
      if (pkg.peerDependenciesMeta?.[name]?.optional) {
        delete pkg.peerDependencies[name];
        delete pkg.peerDependenciesMeta[name];
      }
    }
  }
  return pkg;
}

module.exports = { hooks: { readPackage } };
