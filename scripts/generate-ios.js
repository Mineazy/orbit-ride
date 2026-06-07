import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const rootDir = process.cwd();

function generateRole(role, appId, appName, nativeFolder) {
  console.log(`\n==================================================`);
  console.log(` GENERATING iOS APP: ${appName} (${role.toUpperCase()})`);
  console.log(`==================================================`);

  // 1. Copy config
  const srcConfig = path.join(rootDir, `capacitor.config.${role}.json`);
  const destConfig = path.join(rootDir, 'capacitor.config.json');
  console.log(`- Copying ${path.basename(srcConfig)} to capacitor.config.json`);
  fs.copyFileSync(srcConfig, destConfig);

  // 2. Build web assets with VITE_APP_ROLE
  console.log(`- Compiling Vite web assets for ${role}...`);
  execSync(`VITE_APP_ROLE=${role} npm run build`, { stdio: 'inherit', env: { ...process.env, VITE_APP_ROLE: role } });

  const nativePath = path.join(rootDir, nativeFolder);
  const iosSymlink = path.join(rootDir, 'ios');

  // Ensure any old 'ios' folder/symlink in root is removed
  if (fs.existsSync(iosSymlink)) {
    console.log(`- Cleaning up existing 'ios' folder/symlink in root`);
    fs.rmSync(iosSymlink, { recursive: true, force: true });
  }

  if (!fs.existsSync(nativePath) || fs.readdirSync(nativePath).length === 0) {
    console.log(`- Target directory ${nativeFolder} does not exist. Adding iOS platform...`);
    try {
      execSync('npx cap add ios', { stdio: 'inherit' });
      
      if (fs.existsSync(iosSymlink)) {
        console.log(`- Moving 'ios' directory to '${nativeFolder}'`);
        if (fs.existsSync(nativePath)) {
          fs.rmSync(nativePath, { recursive: true, force: true });
        }
        fs.renameSync(iosSymlink, nativePath);
      }
    } catch (capError) {
      console.warn(`\n⚠ Capacitor add completed with warnings/errors (expected on non-macOS platforms due to CocoaPods requirements):`, capError.message);
      
      if (fs.existsSync(iosSymlink)) {
        console.log(`- Moving partially created 'ios' directory to '${nativeFolder}'`);
        if (fs.existsSync(nativePath)) {
          fs.rmSync(nativePath, { recursive: true, force: true });
        }
        fs.renameSync(iosSymlink, nativePath);
      }
    }
  } else {
    console.log(`- Linking 'ios' -> '${nativeFolder}'`);
    fs.symlinkSync(nativeFolder, iosSymlink, 'dir');

    console.log(`- Syncing assets with Capacitor...`);
    try {
      execSync('npx cap sync ios', { stdio: 'inherit' });
    } catch (capError) {
      console.warn(`\n⚠ Capacitor sync completed with warnings/errors (expected on non-macOS platforms due to CocoaPods requirements):`, capError.message);
    }

    console.log(`- Cleaning up 'ios' symlink`);
    fs.rmSync(iosSymlink, { force: true });
  }
}

try {
  // Generate Passenger iOS
  generateRole('passenger', 'com.orbitride.passenger', 'OrbitRide Passenger', 'ios-passenger');
  
  // Generate Driver iOS
  generateRole('driver', 'com.orbitride.driver', 'OrbitRide Driver', 'ios-driver');
  
  console.log(`\n==================================================`);
  console.log(`✔ iOS PROJECT GENERATION COMPLETED!`);
  console.log(`Find your Xcode workspaces in:`);
  console.log(`  - ios-passenger`);
  console.log(`  - ios-driver`);
  console.log(`==================================================\n`);
} catch (err) {
  console.error('Fatal iOS generation script error:', err);
}
