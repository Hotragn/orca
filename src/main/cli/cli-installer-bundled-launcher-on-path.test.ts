import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises'
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

// Why (#33872): Orca's terminals put the bundled bin dir first on PATH, and that launcher reads as a
// managed Orca launcher, so registration once picked the launcher itself and linked it to itself.
describe('CliInstaller with the bundled launcher on PATH', () => {
  it.skipIf(process.platform === 'win32')(
    'never registers the bundled launcher as its own command path',
    async () => {
      const fixture = await makeFixture()
      const homePath = join(fixture.root, 'home')
      const resourcesPath = join(fixture.root, 'Orca.app', 'Contents', 'Resources')
      const bundledBin = join(resourcesPath, 'bin')
      const launcherPath = join(bundledBin, 'orca')
      const launcher = await readFile(
        join(process.cwd(), 'resources', 'darwin', 'bin', 'orca'),
        'utf8'
      )
      await mkdir(bundledBin, { recursive: true })
      await writeFile(launcherPath, launcher, { mode: 0o755 })
      const usrLocalBin = join(fixture.root, 'usr', 'local', 'bin')
      await mkdir(usrLocalBin, { recursive: true })

      const installer = new CliInstaller({
        platform: 'darwin',
        isPackaged: true,
        resourcesPath,
        userDataPath: fixture.userDataPath,
        execPath: join(fixture.root, 'Orca.app', 'Contents', 'MacOS', 'Orca'),
        appPath: fixture.appPath,
        homePath,
        defaultMacCommandPath: join(usrLocalBin, 'orca'),
        processPathEnv: [bundledBin, usrLocalBin].join(':')
      })

      const status = await installer.install()

      expect(status.commandPath).toBe(join(usrLocalBin, 'orca'))
      expect((await lstat(launcherPath)).isSymbolicLink()).toBe(false)
      expect(await readFile(launcherPath, 'utf8')).toBe(launcher)
    }
  )

  it.skipIf(process.platform === 'win32')(
    'refuses a command path override that names the launcher itself',
    async () => {
      const fixture = await makeFixture()
      const resourcesPath = join(fixture.root, 'Orca.app', 'Contents', 'Resources')
      const launcherPath = join(resourcesPath, 'bin', 'orca')
      await mkdir(join(resourcesPath, 'bin'), { recursive: true })
      await writeFile(
        launcherPath,
        await readFile(join(process.cwd(), 'resources', 'darwin', 'bin', 'orca'), 'utf8'),
        { mode: 0o755 }
      )

      const installer = new CliInstaller({
        platform: 'darwin',
        isPackaged: true,
        resourcesPath,
        userDataPath: fixture.userDataPath,
        execPath: join(fixture.root, 'Orca.app', 'Contents', 'MacOS', 'Orca'),
        appPath: fixture.appPath,
        homePath: join(fixture.root, 'home'),
        commandPathOverride: launcherPath
      })

      await expect(installer.install()).rejects.toThrow('link to itself')
      expect((await lstat(launcherPath)).isSymbolicLink()).toBe(false)
    }
  )
})
