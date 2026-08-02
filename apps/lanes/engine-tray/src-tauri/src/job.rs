// job.rs — a Windows Job Object with kill-on-close, so a force-killed or crashed tray can't
// orphan the engine and file service holding their ports. Membership is inherited, which
// covers the tsx-forked file service for free. See docs/tray.md.

#[cfg(windows)]
mod imp {
    use std::os::windows::io::AsRawHandle;
    use std::process::Child;
    use std::sync::OnceLock;

    use windows::core::PCWSTR;
    use windows::Win32::Foundation::HANDLE;
    use windows::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };

    // The job HANDLE as a usize (a raw pointer isn't Send/Sync); 0 means creation failed. NEVER closed: closing it
    // is exactly what triggers the kill, and the OS doing so at process exit is the mechanism we rely on.
    static JOB: OnceLock<usize> = OnceLock::new();

    /// Create the kill-on-close job once, at startup. A failure only leaves the safety net off; never fatal.
    pub fn init() {
        JOB.get_or_init(|| unsafe {
            let job = match CreateJobObjectW(None, PCWSTR::null()) {
                Ok(h) if !h.is_invalid() => h,
                _ => return 0,
            };
            let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            let _ = SetInformationJobObject(
                job,
                JobObjectExtendedLimitInformation,
                &info as *const _ as *const core::ffi::c_void,
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            );
            job.0 as usize
        });
    }

    /// Put a freshly-spawned child — and everything it later spawns — under the job. A no-op when there is no job
    /// or the assign fails (a tray already in a job that forbids nesting); the child then falls back to graceful quit.
    pub fn assign(child: &Child) {
        let Some(&raw) = JOB.get() else { return };
        if raw == 0 {
            return;
        }
        let job = HANDLE(raw as *mut _);
        let proc = HANDLE(child.as_raw_handle() as *mut _);
        unsafe {
            let _ = AssignProcessToJobObject(job, proc);
        }
    }
}

#[cfg(not(windows))]
mod imp {
    pub fn init() {}
    pub fn assign(_child: &std::process::Child) {}
}

pub use imp::{assign, init};
