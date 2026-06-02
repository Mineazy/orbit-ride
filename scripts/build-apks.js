import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const rootDir = process.cwd();
const artifactsDir = path.join(rootDir, 'build-artifacts');

// Ensure artifacts folder exists
if (!fs.existsSync(artifactsDir)) {
  fs.mkdirSync(artifactsDir, { recursive: true });
}

// Find Java 21 path
let javaHomeEnv = '';
const potentialJavas = [
  '/usr/lib/jvm/java-21-openjdk',
  '/usr/lib/jvm/java-21',
  '/usr/lib/jvm/java-21-openjdk-amd64'
];
for (const jPath of potentialJavas) {
  if (fs.existsSync(jPath)) {
    javaHomeEnv = `JAVA_HOME=${jPath}`;
    break;
  }
}

function buildRole(role, appId, appName, nativeFolder) {
  console.log(`\n==================================================`);
  console.log(` BUILDING MOBILE APP: ${appName} (${role.toUpperCase()})`);
  console.log(`==================================================`);

  // 1. Copy config
  const srcConfig = path.join(rootDir, `capacitor.config.${role}.json`);
  const destConfig = path.join(rootDir, 'capacitor.config.json');
  console.log(`- Copying ${path.basename(srcConfig)} to capacitor.config.json`);
  fs.copyFileSync(srcConfig, destConfig);

  // 2. Setup symlink/folder for android
  const androidSymlink = path.join(rootDir, 'android');
  if (fs.existsSync(androidSymlink)) {
    console.log(`- Cleaning up existing 'android' folder/symlink`);
    fs.rmSync(androidSymlink, { recursive: true, force: true });
  }
  
  console.log(`- Linking 'android' -> '${nativeFolder}'`);
  fs.symlinkSync(nativeFolder, androidSymlink, 'dir');

  // 3. Build web assets with VITE_APP_ROLE
  console.log(`- Compiling Vite web assets for ${role}...`);
  execSync(`VITE_APP_ROLE=${role} npm run build`, { stdio: 'inherit', env: { ...process.env, VITE_APP_ROLE: role } });

  // 4. Capacitor sync
  console.log(`- Syncing assets with Capacitor...`);
  execSync('npx cap sync', { stdio: 'inherit' });

  // 5. Compile APK
  console.log(`- Compiling APK with Gradle...`);
  const androidDir = path.join(rootDir, 'android');
  
  try {
    const cmd = `${javaHomeEnv ? javaHomeEnv + ' ' : ''}./gradlew assembleDebug`;
    console.log(`  Running: ${cmd}`);
    execSync(cmd, { cwd: androidDir, stdio: 'inherit' });
    
    // 6. Copy output APK
    const compiledApkPath = path.join(androidDir, 'app/build/outputs/apk/debug/app-debug.apk');
    const destApkPath = path.join(artifactsDir, `orbitride-${role}-debug.apk`);
    
    if (fs.existsSync(compiledApkPath)) {
      fs.copyFileSync(compiledApkPath, destApkPath);
      console.log(`\n✔ SUCCESS! Compiled ${role} APK copied to:`);
      console.log(`  ${destApkPath}`);
    } else {
      console.error(`\n❌ Error: Compiled APK not found at ${compiledApkPath}`);
    }
  } catch (error) {
    console.error(`\n❌ Build failed for ${role}:`, error.message);
  } finally {
    // 7. Cleanup symlink
    console.log(`- Cleaning up 'android' symlink`);
    fs.rmSync(androidSymlink, { force: true });
  }
}

try {
  // Build Passenger
  buildRole('passenger', 'com.orbitride.passenger', 'OrbitRide Passenger', 'android-passenger');
  
  // Build Driver
  buildRole('driver', 'com.orbitride.driver', 'OrbitRide Driver', 'android-driver');
  
  console.log(`\n==================================================`);
  console.log(`✔ MOBILE APP COMPILATION COMPLETED!`);
  console.log(`Find your APKs in: ${artifactsDir}`);
  console.log(`==================================================\n`);
} catch (err) {
  console.error('Fatal build script error:', err);
}
