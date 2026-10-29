import { lstat, mkdir, readFile, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => tmpdir(),
    getAppPath: () => tmpdir()
  }
}))

import { CliInstaller } from './cli-installer'
import { makeFixture } from './cli-installer-test-fixtures'

async function makeBundledLauncherFixture() {
  const fixture = await makeFixture()
  const resourcesPath = join(fixture.root, 'Orca.app', 'Contents', 'Resources')
  const bundledBin = join(resourcesPath, 'bin')
  const launcherPath = join(bundledBin, 'orca')
  // The real launcher reads as a managed Orca launcher, which is what made it look replaceable.
  const launcher = await readFile(join(process.cwd(), 'resources', 'darwin', 'bin', 'orca'), 'utf8')
  await mkdir(bundledBin, { recursive: true })
  await writeFile(launcherPath, launcher, { mode: 0o755 })
  return {
    root: fixture.root,
    bundledBin,
    installerOptions: {
      platform: 'darwin' as const,
      isPackaged: true,
      resourcesPath,
      userDataPath: fixture.userDataPath,
      execPath: join(fixture.root, 'Orca.app', 'Contents', 'MacOS', 'Orca'),
      appPath: fixture.appPath,
      homePath: join(fixture.root, 'home')
    },
    expectLauncherIntact: async () => {
      expect((await lstat(launcherPath)).isSymbolicLink()).toBe(false)
      expect(await readFile(launcherPath, 'utf8')).toBe(launcher)
    }
  }
}

// Why (#33872): Orca terminals put the bundled bin dir first on PATH, so `orca serve` registration
// picked the bundled launcher as the command path and replaced it with a symlink to itself.
describe.skipIf(process.platform === 'win32')(
  'CliInstaller with the bundled launcher on PATH',
  () => {
    it('registers the default command instead of linking the launcher to itself', async () => {
      const { root, bundledBin, installerOptions, expectLauncherIntact } =
        await makeBundledLauncherFixture()
      const usrLocalBin = join(root, 'usr', 'local', 'bin')
      await mkdir(usrLocalBin, { recursive: true })

      const status = await new CliInstaller({
        ...installerOptions,
        defaultMacCommandPath: join(usrLocalBin, 'orca'),
        processPathEnv: [bundledBin, usrLocalBin].join(':')
      }).install()

      expect(status.state).toBe('installed')
      expect(status.commandPath).toBe(join(usrLocalBin, 'orca'))
      await expectLauncherIntact()
    })

    it('refuses a command path that reaches the launcher through an aliased directory', async () => {
      const { root, bundledBin, installerOptions, expectLauncherIntact } =
        await makeBundledLauncherFixture()
      const aliasBin = join(root, 'alias-bin')
      await symlink(bundledBin, aliasBin)

      const installer = new CliInstaller({
        ...installerOptions,
        commandPathOverride: join(aliasBin, 'orca')
      })

      await expect(installer.install()).rejects.toThrow('link to itself')
      await expectLauncherIntact()
    })
  }
)
