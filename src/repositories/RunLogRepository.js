class RunLogRepository {
  constructor(versionedRepository) {
    this.versionedRepository = versionedRepository;
  }
  async saveMany(logEntries, connection) {
    if (!logEntries.length) return [];
    return this.versionedRepository.saveRecord('formula_run_logs', logEntries, { connection });
  }
}
module.exports = RunLogRepository;
