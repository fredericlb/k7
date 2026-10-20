// sink.rs — where an encoder's bytes go: written at a position, since every container here goes back to patch its head.

pub trait Sink {
    fn write_at(&mut self, pos: u64, bytes: &[u8]) -> Result<(), String>;
}

/// A file held in memory, for the tests.
impl Sink for Vec<u8> {
    fn write_at(&mut self, pos: u64, bytes: &[u8]) -> Result<(), String> {
        let at = pos as usize;
        if self.len() < at + bytes.len() {
            self.resize(at + bytes.len(), 0);
        }
        self[at..at + bytes.len()].copy_from_slice(bytes);
        Ok(())
    }
}
