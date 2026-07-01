import { Router, type IRouter } from "express";
import healthRouter from "./health";
import visionRouter from "./vision";

const router: IRouter = Router();

router.use(healthRouter);
router.use(visionRouter);

export default router;
