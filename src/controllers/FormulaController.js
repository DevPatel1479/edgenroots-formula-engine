class FormulaController {
  constructor({ formulaService, previewService }) {
    this.formulaService = formulaService;
    this.previewService = previewService;
    this.list = this.list.bind(this);
    this.createOrChange = this.createOrChange.bind(this);
    this.deactivate = this.deactivate.bind(this);
    this.rollback = this.rollback.bind(this);
    this.history = this.history.bind(this);
    this.impact = this.impact.bind(this);
    this.preview = this.preview.bind(this);
    this.previewBulk = this.previewBulk.bind(this);
  }

  async list(_req, res) {
    res.json({ data: await this.formulaService.list() });
  }
  async createOrChange(req, res) {
    const saved = await this.formulaService.createOrChange(req.validatedBody);
    res.status(req.validatedBody.uuid ? 200 : 201).json({ data: saved });
  }
  async deactivate(req, res) {
    res.json({ data: await this.formulaService.deactivate(req.params.uuid, req.validatedBody) });
  }
  async rollback(req, res) {
    res.json({ data: await this.formulaService.rollback(req.params.uuid, req.validatedBody) });
  }
  async history(req, res) {
    res.json({ data: await this.formulaService.history(req.params.uuid) });
  }
  async impact(req, res) {
    res.json({ data: await this.formulaService.impact(req.params.uuid) });
  }
  async preview(req, res) {
    res.json({ data: await this.previewService.previewOne(req.validatedBody) });
  }
  async previewBulk(req, res) {
    res.json({ data: await this.previewService.previewBulk(req.validatedBody) });
  }
}
module.exports = FormulaController;
