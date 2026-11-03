import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { ValidationException } from '@/common/exceptions/app.exception';

export const createValidationPipe = (): ValidationPipe =>
  new ValidationPipe({
    whitelist: true, //tự động loại bỏ các thuộc tính không được định nghĩa trong DTOs
    forbidNonWhitelisted: true, //nếu có thuộc tính không được định nghĩa trong DTO thì sẽ ném ra lỗi
    transform: true, //tự động chuyển đổi payload thành các instance của lớp DTO

    // D7: lỗi validate → VALIDATION_ERROR, details giữ lỗi theo field
    exceptionFactory: (errors) =>
      new ValidationException(
        'Validation failed',
        errors.map((error) => ({
          field: error.property, // Tên của trường bị lỗi
          messages: Object.values(error.constraints || {}), // Các thông báo lỗi liên quan đến trường đó
        })),
      ),
  });

export const validationConfig: (app: INestApplication) => void = (
  app: INestApplication,
) => {
  app.useGlobalPipes(createValidationPipe());
};
