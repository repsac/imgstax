"""Post-processing command execution for stacked images."""

import logging
import subprocess
import os
from pathlib import Path
from typing import Optional, Dict, Any

logger = logging.getLogger(__name__)


def execute_post_processing(
    command: str,
    working_directory: str,
    env_vars: Optional[Dict[str, str]] = None,
    progress_callback=None
) -> Dict[str, Any]:
    """Execute a post-processing command.

    Args:
        command: Shell command to execute
        working_directory: Directory to run command in
        env_vars: Optional environment variables to add/override
        progress_callback: Optional callback function for progress updates

    Returns:
        Dict with 'success', 'stdout', 'stderr', 'return_code'

    Raises:
        ValueError: If working directory doesn't exist
    """
    work_dir = Path(working_directory)
    if not work_dir.exists():
        raise ValueError(f"Working directory does not exist: {working_directory}")

    if not work_dir.is_dir():
        raise ValueError(f"Working directory is not a directory: {working_directory}")

    logger.info(f"Executing post-processing command in {working_directory}")
    logger.debug(f"Command: {command}")

    # Build environment: inherit user's environment and add custom vars
    env = os.environ.copy()
    if env_vars:
        env.update(env_vars)
        logger.debug(f"Added environment variables: {list(env_vars.keys())}")

    try:
        # Execute command using OS-appropriate shell
        import platform
        system = platform.system()

        if system == 'Windows':
            # Use PowerShell on Windows for better command support
            shell_cmd = ['powershell.exe', '-NoProfile', '-Command', command]
        else:
            # Use bash on Unix-like systems (macOS, Linux)
            shell_cmd = ['/bin/bash', '-c', command]

        logger.debug(f"Using shell: {shell_cmd[0]}")

        process = subprocess.Popen(
            shell_cmd,
            cwd=str(work_dir),
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
            universal_newlines=True
        )

        # Collect output
        stdout_lines = []
        stderr_lines = []

        # Read output in real-time
        while True:
            # Check if process has finished
            return_code = process.poll()

            # Read available output
            if process.stdout:
                line = process.stdout.readline()
                if line:
                    stdout_lines.append(line.rstrip())
                    logger.debug(f"STDOUT: {line.rstrip()}")
                    if progress_callback:
                        progress_callback('stdout', line.rstrip())

            if process.stderr:
                line = process.stderr.readline()
                if line:
                    stderr_lines.append(line.rstrip())
                    logger.debug(f"STDERR: {line.rstrip()}")
                    if progress_callback:
                        progress_callback('stderr', line.rstrip())

            # Break if process finished and no more output
            if return_code is not None:
                # Read remaining output
                if process.stdout:
                    for line in process.stdout:
                        stdout_lines.append(line.rstrip())
                        logger.debug(f"STDOUT: {line.rstrip()}")
                if process.stderr:
                    for line in process.stderr:
                        stderr_lines.append(line.rstrip())
                        logger.debug(f"STDERR: {line.rstrip()}")
                break

        stdout = '\n'.join(stdout_lines)
        stderr = '\n'.join(stderr_lines)

        # Check for error patterns in stderr even if return code is 0
        # Some commands (like ffmpeg) exit with 0 even when they fail
        error_patterns = [
            'error opening',
            'error:',
            'failed to',
            'could not',
            'not overwriting',
            'permission denied',
            'no such file',
        ]

        stderr_lower = stderr.lower()
        has_error_in_stderr = any(pattern in stderr_lower for pattern in error_patterns)

        success = (return_code == 0) and not has_error_in_stderr

        if success:
            logger.info(f"Post-processing completed successfully (return code: {return_code})")
        else:
            if has_error_in_stderr:
                logger.error(f"Post-processing detected errors in output (return code: {return_code})")
            else:
                logger.error(f"Post-processing failed with return code: {return_code}")
            if stderr:
                logger.error(f"Error output: {stderr}")

        return {
            'success': success,
            'stdout': stdout,
            'stderr': stderr,
            'return_code': return_code
        }

    except Exception as e:
        logger.error(f"Post-processing execution failed: {str(e)}", exc_info=True)
        return {
            'success': False,
            'stdout': '',
            'stderr': str(e),
            'return_code': -1
        }


def validate_command(command: str) -> bool:
    """Basic validation of command string.

    Args:
        command: Command string to validate

    Returns:
        True if command appears valid
    """
    if not command or not command.strip():
        return False

    # Just check it's not empty - we don't validate if the command exists
    # That's the user's responsibility
    return True
