const { execSync, execFile } = require('child_process');
const { promisify } = require('util');
const path = require('path');
const fs = require('fs');
const os = require('os');

const execFileAsync = promisify(execFile);

const TASK_NAME = 'HelpGames Blocker';

function isElevated() {
  try { execSync('net session', { stdio: 'ignore' }); return true; }
  catch { return false; }
}

async function isTaskInstalled() {
  try {
    await execFileAsync('schtasks', ['/query', '/tn', TASK_NAME, '/fo', 'LIST'], { windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

async function createTask(exePath) {
  // Write a temp .ps1 so we avoid quoting hell in the command line
  const ps1 = path.join(os.tmpdir(), 'hg-task.ps1');
  const script = `
$action  = New-ScheduledTaskAction -Execute '${exePath.replace(/'/g, "''")}' -WorkingDirectory '${path.dirname(exePath).replace(/'/g, "''")}'
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit 0
$principal = New-ScheduledTaskPrincipal -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) -RunLevel Highest -LogonType Interactive
$task = New-ScheduledTask -Action $action -Trigger $trigger -Settings $settings -Principal $principal
Register-ScheduledTask -TaskName '${TASK_NAME.replace(/'/g, "''")}' -InputObject $task -Force
`;
  fs.writeFileSync(ps1, script, 'utf8');
  try {
    await execFileAsync('powershell.exe', [
      '-NonInteractive', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1,
    ], { windowsHide: true });
  } finally {
    try { fs.unlinkSync(ps1); } catch {}
  }
}

async function runTask() {
  await execFileAsync('schtasks', ['/run', '/tn', TASK_NAME], { windowsHide: true });
}

async function deleteTask() {
  try {
    await execFileAsync('schtasks', ['/delete', '/tn', TASK_NAME, '/f'], { windowsHide: true });
  } catch {}
}

async function installCACert(dataDir) {
  const certPath = path.join(dataDir, 'hg-ca.cert.pem');
  if (!fs.existsSync(certPath)) return; // cert-manager hasn't run yet — skip
  await execFileAsync('certutil', ['-addstore', '-f', 'Root', certPath], { windowsHide: true });
}

function relaunchElevated(flag) {
  const args = flag ? `'${flag}'` : '';
  execFile('powershell.exe', [
    '-NonInteractive', '-NoProfile', '-WindowStyle', 'Hidden', '-Command',
    `Start-Process -FilePath '${process.execPath.replace(/'/g, "''")}' -ArgumentList ${args} -Verb RunAs -WindowStyle Hidden`,
  ], { windowsHide: true });
}

module.exports = { isElevated, isTaskInstalled, createTask, runTask, deleteTask, installCACert, relaunchElevated };
